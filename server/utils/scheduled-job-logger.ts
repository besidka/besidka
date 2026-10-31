import type { createRequestLogger } from 'evlog'
import { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'

type ScheduledJobLogger = Pick<
  ReturnType<typeof createRequestLogger>,
  'emit'
>

/**
 * Emits a cron job's wide event and ships it to Axiom. A standalone
 * `createRequestLogger().emit()` only reaches the Worker console under the
 * Nitro adapter, so every `cloudflare:scheduled` job must finish through this
 * helper. Awaiting is safe: Nitro wraps the scheduled handler in `waitUntil`.
 * A failing ship never reaches the job.
 */
export async function emitScheduledJobEvent(
  logger: ScheduledJobLogger,
  status: number,
  shipWideEvent: typeof shipWideEventToAxiom = shipWideEventToAxiom,
): Promise<void> {
  const wideEvent = logger.emit({ status })

  if (!wideEvent) {
    return
  }

  try {
    await shipWideEvent(wideEvent)
  } catch (exception) {
    // eslint-disable-next-line no-console
    console.error('[evlog] scheduled job event ship failed:', exception)
  }
}
