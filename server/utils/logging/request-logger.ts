import type { ServerEvent } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { useLogger } from 'evlog'

/**
 * Resolves the evlog request logger from the portable `nuxt/server` event.
 * evlog types its event as the h3 v1 shape (`method`/`path`), which the
 * portable `RequestEvent` omits; only `event.context.log` is read at runtime,
 * and the portable event shares `context` with the real event.
 */
export function useRequestLogger(
  event: Pick<RequestEvent, 'context'>,
  service?: string,
) {
  return useLogger(event as unknown as ServerEvent, service)
}
