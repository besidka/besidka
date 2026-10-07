import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestLogger } from 'evlog'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const GENERATION_GUARD_LEASE_TTL_SECONDS = 120
export const GENERATION_GUARD_HEARTBEAT_INTERVAL_MS = 30_000
export const GENERATION_GUARD_STOP_WAIT_MS = 5_000

type GenerationGuardKv = Pick<KVNamespace, 'put'>
type GenerationGuardLogger = Pick<RequestLogger, 'set'>

export interface GenerationGuardHeartbeat {
  stop: () => Promise<void>
  getRenewalCount: () => number
}

export async function putGenerationGuard(
  kv: GenerationGuardKv,
  key: string,
  operation: 'put' | 'heartbeat',
  logger: GenerationGuardLogger,
): Promise<boolean> {
  try {
    await kv.put(key, '1', {
      expirationTtl: GENERATION_GUARD_LEASE_TTL_SECONDS,
    })

    return true
  } catch (exception) {
    logger.set({
      generationGuard: {
        operation,
      },
      attributes: {
        generationGuard: {
          error: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}

/**
 * Keeps the generation-in-progress KV flag alive for exactly as long as this
 * Worker invocation is alive. The flag is a short lease, not a worst-case
 * generation bound: when the invocation dies (most likely canceled after a
 * client disconnect), neither the persist step nor the `finally` delete
 * runs, and the lease simply stops being renewed and expires. Timer-driven
 * rather than chunk-driven because one provider step can stream nothing for a
 * minute or more. `stop` clears the timer and waits, bounded by
 * `GENERATION_GUARD_STOP_WAIT_MS`, for an in-flight renewal, so awaiting it
 * before deleting the flag keeps a late put from resurrecting the flag
 * without letting a hung put block the delete. `getRenewalCount` reports how
 * many renewals succeeded, so a wide event can prove the timer actually fires.
 */
export function startGenerationGuardHeartbeat(
  kv: GenerationGuardKv,
  key: string,
  logger: GenerationGuardLogger,
): GenerationGuardHeartbeat {
  let inFlightHeartbeat: Promise<void> | null = null
  let renewalCount = 0

  const timer = setInterval(() => {
    if (inFlightHeartbeat) {
      return
    }

    inFlightHeartbeat = putGenerationGuard(kv, key, 'heartbeat', logger)
      .then((isRenewed) => {
        if (isRenewed) {
          renewalCount += 1
        }
      })
      .finally(() => {
        inFlightHeartbeat = null
      })
  }, GENERATION_GUARD_HEARTBEAT_INTERVAL_MS)

  async function stop(): Promise<void> {
    clearInterval(timer)

    if (!inFlightHeartbeat) {
      return
    }

    let stopWaitTimer: ReturnType<typeof setTimeout> | undefined
    const stopWaitElapsed = new Promise<void>((resolve) => {
      stopWaitTimer = setTimeout(resolve, GENERATION_GUARD_STOP_WAIT_MS)
    })

    await Promise.race([inFlightHeartbeat, stopWaitElapsed])

    clearTimeout(stopWaitTimer)
  }

  function getRenewalCount(): number {
    return renewalCount
  }

  return { stop, getRenewalCount }
}
