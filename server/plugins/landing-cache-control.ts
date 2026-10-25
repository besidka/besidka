import type { NitroRuntimeHooks } from 'nitropack/types'

type RequestHookEvent = Parameters<NitroRuntimeHooks['request']>[0]

const LANDING_PATH = '/'
const REVALIDATE_ALWAYS = 'no-cache'
const FRESHNESS_DIRECTIVE = /(?:^|,)\s*(?:s-)?max-age=\d/i

function isFreshnessCacheControl(
  name: string,
  value: unknown,
): value is string {
  return name.toLowerCase() === 'cache-control'
    && typeof value === 'string'
    && FRESHNESS_DIRECTIVE.test(value)
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', pinLandingRevalidation)
})

/**
 * Nitro's cached event handler writes `max-age=<maxAge>` onto every replay
 * (miss, hit and 304 via `handleCacheHeaders`) after the render hooks have run,
 * so no render hook can override it. Wrapping `setHeader` on the real
 * response is the single point all three paths share, and it keeps the body
 * served from the KV cache while the browser always revalidates the HTML shell
 * against the current build.
 */
export function pinLandingRevalidation(event: RequestHookEvent): void {
  const path = event.path.split('?')[0]

  if (path !== LANDING_PATH) {
    return
  }

  const response = event.node.res
  const setHeader = response.setHeader.bind(response)

  response.setHeader = (name: string, value) => {
    return setHeader(
      name,
      isFreshnessCacheControl(name, value) ? REVALIDATE_ALWAYS : value,
    )
  }
}
