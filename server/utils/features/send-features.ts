import type { RequestEvent } from 'nuxt/server'
import type { FeatureKey } from '#shared/utils/features/registry'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export interface SendFeatures {
  isFeatureActive: (flag: FeatureKey) => boolean
}

/**
 * Evaluates the flags a chat send needs once, through the request's
 * memoised feature context, and returns a synchronous lookup for the tool
 * factories. It fails closed: when the evaluation throws, every flag is off
 * and the send goes on without the gated tools.
 */
export async function resolveSendFeatures(
  event: Pick<RequestEvent, 'context'>,
  flags: readonly FeatureKey[],
  logger: LoggerLike,
): Promise<SendFeatures> {
  const active = new Set<FeatureKey>()

  try {
    for (const flag of flags) {
      const resolution = await evaluateFeatureForEvent(event, flag)

      if (resolution.active) {
        active.add(flag)
      }
    }
  } catch (exception) {
    active.clear()
    logger.set({
      attributes: {
        sendFeatures: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return {
    isFeatureActive: (flag) => {
      return active.has(flag)
    },
  }
}
