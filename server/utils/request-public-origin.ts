import type { RequestEvent } from 'nuxt/server'
import { getRequestURL } from 'nuxt/server'
import { resolvePublicOrigin } from '~~/server/utils/auth-hosts'

/**
 * The URL the visitor requested. On Workers, Nitro hands h3 a mock Node
 * request whose `encrypted` flag is never set (it compares `"https:"` with
 * `"https"`) and Cloudflare sends no `X-Forwarded-Proto` to the Worker, so
 * `getRequestURL()` reports `http` for every request. The platform request
 * URL is set by the Cloudflare edge, never by a client header, so its
 * scheme and host are trusted instead.
 */
function resolveRequestUrl(event: RequestEvent): URL {
  const platform = event.context.cloudflare as { url?: unknown } | undefined
  const platformUrl = platform?.url

  if (platformUrl instanceof URL) {
    return platformUrl
  }

  return getRequestURL(event)
}

export function resolveRequestPublicOrigin(event: RequestEvent): string {
  const config = useRuntimeConfig()

  return resolvePublicOrigin(
    resolveRequestUrl(event),
    String(config.public.baseUrl ?? ''),
    String(config.authAdditionalAllowedHosts ?? ''),
  )
}
