import type { RequestEvent } from 'nuxt/server'
import { getRequestURL } from 'nuxt/server'
import { resolvePublicOrigin } from '~~/server/utils/auth-hosts'

function resolvePlatformRequestUrl(event: RequestEvent): URL {
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
    resolvePlatformRequestUrl(event),
    String(config.public.baseUrl ?? ''),
    String(config.authAdditionalAllowedHosts ?? ''),
  )
}
