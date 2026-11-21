import type { UIMessageChunk } from 'ai'
import type { ChatErrorCode } from '#shared/types/chat-errors.d'
import { GENERATION_STOPPED_REASON } from '~~/server/utils/chats/generation-lease'

export const DEEPSEEK_FIRST_CHUNK_TIMEOUT_MS = 120_000
export const DEEPSEEK_CHUNK_TIMEOUT_MS = 90_000

const FIRST_CHUNK_TIMEOUT_PATTERN = /^First chunk timeout\b/
const CHUNK_TIMEOUT_PATTERN = /^Chunk timeout\b/

export interface StreamTimeout {
  totalMs?: number
  toolMs?: number
  firstChunkMs?: number
  chunkMs?: number
}

/**
 * The `streamText` timeout of one send: the tool loop's total and tool
 * limits, plus, for a provider known to hold a request silently, how long
 * the model may stay silent. DeepSeek answers a queued request with SSE
 * `: keep-alive` comments only and closes it after 10 minutes if inference
 * never started (its Rate Limit docs); the AI SDK drops comments, so without
 * `firstChunkMs` a send waited up to the 540 s total limit with nothing to
 * show (owner report, 2026-11-20). `chunkMs` ends a stream that stops
 * mid-answer. Other providers keep no output timeout: hidden reasoning
 * (OpenAI without summaries) can be silent for minutes.
 */
export function resolveStreamTimeout(input: {
  providerId: string | undefined
  base?: StreamTimeout
}): StreamTimeout | undefined {
  if (input.providerId !== 'deepseek') {
    return input.base
  }

  return {
    ...input.base,
    firstChunkMs: DEEPSEEK_FIRST_CHUNK_TIMEOUT_MS,
    chunkMs: DEEPSEEK_CHUNK_TIMEOUT_MS,
  }
}

/**
 * The chat error code of a server-side abort. The send route wires no
 * client-disconnect signal into `streamText`, so every abort the server sees
 * is a timeout: the first-chunk timeout means the provider never started
 * (`provider-queued`), the chunk timeout that it stopped mid-answer
 * (`provider-stalled`), and anything else (the total limit, whose reason
 * carries no label) that the reply ran out of time
 * (`generation-time-limit`).
 */
export function stallErrorCodeOf(reason: string | undefined): ChatErrorCode {
  if (reason && FIRST_CHUNK_TIMEOUT_PATTERN.test(reason)) {
    return 'provider-queued'
  }

  return reason && CHUNK_TIMEOUT_PATTERN.test(reason)
    ? 'provider-stalled'
    : 'generation-time-limit'
}

/**
 * Turns the `abort` chunk of a timed-out send into an `error` chunk the
 * client shows like any failed reply. Before, a timeout ended the stream
 * with `abort`: the client treated it as a user Stop (no error, spinner
 * gone without a word) and persistence skipped the reply. The abort of a
 * run the user stopped (`GENERATION_STOPPED_REASON`) stays an `abort`.
 */
export function withVisibleTimeoutErrors(
  stream: ReadableStream<UIMessageChunk>,
  toErrorText: (code: ChatErrorCode, reason: string | undefined) => string,
): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(new TransformStream<
    UIMessageChunk,
    UIMessageChunk
  >({
    transform(chunk, controller) {
      if (chunk.type !== 'abort') {
        controller.enqueue(chunk)

        return
      }

      const reason = typeof chunk.reason === 'string' ? chunk.reason : undefined

      if (reason === GENERATION_STOPPED_REASON) {
        controller.enqueue(chunk)

        return
      }

      controller.enqueue({
        type: 'error',
        errorText: toErrorText(stallErrorCodeOf(reason), reason),
      })
    },
  }))
}
