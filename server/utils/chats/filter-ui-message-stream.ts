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
