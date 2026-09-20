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
