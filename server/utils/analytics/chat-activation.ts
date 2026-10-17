import { createRequestLogger } from 'evlog'
import { recordFirstChatMessageActivation } from '~~/server/utils/analytics/activation'
import { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'

interface FirstChatMessageTrackingInput {
  userId: number
  providerId: string
  path: string
  parentRequestId?: string
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Runs on its own standalone wide event so the chat's AI cost event never
 * waits on activation D1 work, and ships that event only when the activation
 * actually fired or failed, never for the steady-state skip.
 */
export async function trackFirstChatMessage(
  input: FirstChatMessageTrackingInput,
): Promise<void> {
  try {
    const activationLogger = createRequestLogger({
      method: 'POST',
      path: input.path,
      waitUntil: input.waitUntil,
    })

    activationLogger.set({
      operation: 'activation',
      service: 'app',
      feature: 'chat',
      _parentRequestId: input.parentRequestId,
      userId: input.userId,
    })

    const outcome = await recordFirstChatMessageActivation(
      input.userId,
      input.providerId,
      activationLogger,
    )

    if (outcome === 'skipped') {
      return
    }

    const wideEvent = activationLogger.emit({
      message: outcome === 'fired'
        ? 'Activation recorded'
        : 'Activation failed',
      status: 200,
    })

    if (wideEvent && input.waitUntil) {
      await shipWideEventToAxiom(wideEvent)
    }
  } catch {
    return
  }
}
