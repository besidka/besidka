import type { ChatErrorPayload } from '#shared/types/chat-errors.d'

interface UIMessageChunkLike {
  type?: string
  delta?: string
  errorText?: string
}

export function filterRecoverableUIMessageStreamErrors<
  T extends UIMessageChunkLike,
>(
  stream: ReadableStream<T>,
): ReadableStream<T> {
  if (typeof stream?.pipeThrough !== 'function') {
    return stream
  }

  let hasVisibleAssistantText = false
  const deferredRecoverableErrors: T[] = []

  return stream.pipeThrough(new TransformStream({
    transform(chunk: T, controller: TransformStreamDefaultController<T>) {
      if (
        chunk.type === 'text-delta'
        && typeof chunk.delta === 'string'
        && chunk.delta.trim().length > 0
      ) {
        hasVisibleAssistantText = true
      }

      if (
        chunk.type === 'error'
        && isRecoverableRateLimitError(chunk.errorText)
      ) {
        deferredRecoverableErrors.push(chunk)

        return
      }

      controller.enqueue(chunk)
    },
    flush(controller: TransformStreamDefaultController<T>) {
      if (hasVisibleAssistantText) {
        return
      }

      for (const chunk of deferredRecoverableErrors) {
        controller.enqueue(chunk)
      }
    },
  }))
}

interface TextGapChunkLike {
  type?: string
  id?: string
  delta?: string
}

/**
 * Some provider mappers (confirmed for xAI's Responses API path) never emit
 * `text-end` between a pre-tool-call text segment and a post-tool-call
 * continuation of the SAME logical text part — they only emit `text-start`
 * once per id and reuse it across a tool-call gap. Without this transform,
 * the two segments render and persist glued together with no boundary
 * between them (e.g. a sentence-ending period directly followed by the next
 * segment's markdown heading).
 */
export function insertParagraphBreakAfterNonTextGap<
  T extends TextGapChunkLike,
>(stream: ReadableStream<T>): ReadableStream<T> {
  if (typeof stream?.pipeThrough !== 'function') {
    return stream
  }

  const accumulatedTextById = new Map<string, string>()
  const isGapPendingById = new Map<string, boolean>()

  return stream.pipeThrough(new TransformStream({
    transform(chunk: T, controller: TransformStreamDefaultController<T>) {
      if (chunk.type === 'text-start' && typeof chunk.id === 'string') {
        accumulatedTextById.set(chunk.id, '')
        isGapPendingById.set(chunk.id, false)

        controller.enqueue(chunk)

        return
      }

      if (chunk.type === 'text-end' && typeof chunk.id === 'string') {
        accumulatedTextById.delete(chunk.id)
        isGapPendingById.delete(chunk.id)

        controller.enqueue(chunk)

        return
      }

      if (
        typeof chunk.type === 'string'
        && (
          chunk.type.startsWith('tool-')
          || chunk.type.startsWith('reasoning-')
        )
      ) {
        for (const id of accumulatedTextById.keys()) {
          isGapPendingById.set(id, true)
        }

        controller.enqueue(chunk)

        return
      }

      if (
        chunk.type === 'text-delta'
        && typeof chunk.id === 'string'
        && typeof chunk.delta === 'string'
      ) {
        if (chunk.delta.length === 0) {
          controller.enqueue(chunk)

          return
        }

        const accumulatedText = accumulatedTextById.get(chunk.id) ?? ''
        const isGapPending = isGapPendingById.get(chunk.id) ?? false

        let delta = chunk.delta

        if (
          isGapPending
          && accumulatedText.length > 0
          && !/\s$/.test(accumulatedText)
        ) {
          delta = `\n\n${delta}`
        }

        accumulatedTextById.set(chunk.id, accumulatedText + delta)
        isGapPendingById.set(chunk.id, false)

        controller.enqueue({ ...chunk, delta })

        return
      }

      controller.enqueue(chunk)
    },
  }))
}

interface ExternalSearchResultLike {
  title?: string
  url?: string
}

interface ExternalSearchToolOutputLike {
  provider?: string
  results?: ExternalSearchResultLike[]
}

interface ToolOutputChunkLike {
  type?: string
  output?: unknown
}

interface SourceUrlChunkLike {
  type: 'source-url'
  sourceId: string
  url: string
  title?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isExternalSearchToolOutput(
  output: unknown,
): output is ExternalSearchToolOutputLike {
  return isRecord(output)
    && (output.provider === 'brave' || output.provider === 'exa')
}

/**
 * Brave and Exa are plain tool calls, not provider-native search — the model
 * never emits `source-url` parts for them on its own. This mirrors their
 * `tool-output-available` results into the same `source-url` part type
 * native search uses, so citations render through the existing
 * `UrlSources.vue` path and `getMessageUsedTools()`'s existing
 * `source-url`/`source-document` inference lights up the Web search badge,
 * with no new client-side detection branch.
 *
 * The tool is identified by the `provider` field WP 1.2 puts on the output
 * object, not by tool name: in the AI SDK v7 UI-message-stream, a
 * `tool-output-available` chunk carries `toolCallId` and `output` but no
 * `toolName` — the name only appears on the earlier `tool-input-start` /
 * `tool-input-available` chunks for that same `toolCallId`.
 */
export function emitSourcesForExternalSearchResults<
  T extends ToolOutputChunkLike,
>(
  stream: ReadableStream<T>,
): ReadableStream<T | SourceUrlChunkLike> {
  if (typeof stream?.pipeThrough !== 'function') {
    return stream
  }

  const emittedUrls = new Set<string>()

  return stream.pipeThrough(new TransformStream({
    transform(
      chunk: T,
      controller: TransformStreamDefaultController<T | SourceUrlChunkLike>,
    ) {
      controller.enqueue(chunk)

      if (
        chunk.type !== 'tool-output-available'
        || !isExternalSearchToolOutput(chunk.output)
      ) {
        return
      }

      for (const result of chunk.output.results ?? []) {
        if (!result.url || emittedUrls.has(result.url)) {
          continue
        }

        emittedUrls.add(result.url)

        controller.enqueue({
          type: 'source-url',
          sourceId: crypto.randomUUID(),
          url: result.url,
          title: result.title,
        })
      }
    },
  }))
}

function isRecoverableRateLimitError(
  errorText: string | undefined,
): boolean {
  if (!errorText) {
    return false
  }

  try {
    const parsed = JSON.parse(errorText) as ChatErrorPayload

    return parsed.code === 'provider-rate-limit'
  } catch {
    const normalizedText = errorText.toLowerCase()

    return normalizedText.includes('rate limit')
      || normalizedText.includes('tokens per min')
      || normalizedText.includes('too many requests')
      || normalizedText.includes('try again in')
  }
}
