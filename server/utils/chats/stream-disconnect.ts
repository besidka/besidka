import { createRequestLogger } from 'evlog'
import type { DisconnectedRunEnd } from '~~/server/utils/chats/generation-lease'

/**
 * Passes a response stream through unchanged and calls `onCancel` once when
 * the reader cancels it: on Workers that is the client going away (a Stop in
 * the app aborts the fetch, a closed PWA drops the connection). The
 * invocation can be canceled soon after, before the reply's own wide event
 * is written, so this is the one moment a "client disconnected" line can
 * still be logged. A stream that ends normally never calls it. Anything
 * that is not a readable stream (a test double) passes through as is.
 */
export function withClientDisconnect<Chunk>(
  stream: ReadableStream<Chunk>,
  onCancel: (reason: unknown) => void,
): ReadableStream<Chunk> {
  if (typeof stream?.getReader !== 'function') {
    return stream
  }

  const reader = stream.getReader()
  let isDone = false

  return new ReadableStream<Chunk>({
    async pull(controller) {
      const { done, value } = await reader.read()

      if (done) {
        isDone = true
        controller.close()

        return
      }

      controller.enqueue(value)
    },
    async cancel(reason) {
      if (!isDone) {
        isDone = true

        notifyCancel(onCancel, reason)
      }

      await reader.cancel(reason)
    },
  })
}

/**
 * The response with its body wrapped by `withClientDisconnect`: the body is
 * the outermost stream, the one the runtime cancels when the client goes
 * away. Anything that is not a `Response` with a body passes through.
 */
export function withClientDisconnectResponse<Value>(
  response: Value,
  onCancel: (reason: unknown) => void,
): Value {
  if (!(response instanceof Response) || !response.body) {
    return response
  }

  return new Response(withClientDisconnect(response.body, onCancel), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }) as Value
}

function notifyCancel(
  onCancel: (reason: unknown) => void,
  reason: unknown,
): void {
  try {
    onCancel(reason)
  } catch {
    return
  }
}

/**
 * Writes one "AI stream client disconnected" wide event the moment the
 * client stops reading the reply (Stop in the app, a closed tab or PWA).
 * Workers may cancel the invocation soon after, before the reply's own
 * `AI stream completed` event, which left such sends with no line at all
 * (owner report, 2026-11-20). Shipped through `waitUntil`. `runId` ties it
 * to the stop route's event for the same run. `endRun`, when given, runs
 * first inside the same `waitUntil` (it frees the run's generation lease),
 * and its outcome is recorded on the event.
 */
export function logClientDisconnect(input: {
  aiStreamPath: string
  parentRequestId: string | undefined
  chatId: string
  userId: number
  modelId: string
  runId: string
  isStoppedRun: boolean
  waitUntil: ((promise: Promise<unknown>) => void) | undefined
  endRun?: () => Promise<DisconnectedRunEnd>
}): void {
  const disconnectLogger = createRequestLogger({
    method: 'POST',
    path: input.aiStreamPath,
    waitUntil: input.waitUntil,
  })

  disconnectLogger.set({
    operation: 'ai-stream',
    service: 'app',
    feature: 'chat',
    stage: 'client-disconnected',
    _parentRequestId: input.parentRequestId,
    chatId: input.chatId,
    userId: input.userId,
    modelId: input.modelId,
    attributes: {
      generationGuard: {
        runId: input.runId,
        stoppedBeforeDisconnect: input.isStoppedRun,
      },
    },
  })

  function emitAndShip(): Promise<unknown> | undefined {
    const wideEvent = disconnectLogger.emit({
      message: 'AI stream client disconnected',
      status: 499,
    })

    return wideEvent ? shipWideEventToAxiom(wideEvent) : undefined
  }

  if (!input.endRun) {
    const shipping = emitAndShip()

    if (shipping && input.waitUntil) {
      input.waitUntil(shipping)
    }

    return
  }

  const endRun = input.endRun

  async function endRunThenLog(): Promise<void> {
    const outcome = await endRun()

    disconnectLogger.set({
      attributes: {
        generationGuard: {
          leaseReleased: outcome.leaseReleased,
          ...(outcome.error ? { endRunError: outcome.error } : {}),
        },
      },
    })

    await emitAndShip()
  }

  const ending = endRunThenLog()

  if (input.waitUntil) {
    input.waitUntil(ending)
  }
}
