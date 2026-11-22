import type { RequestEvent } from 'nuxt/server'
import { getRequestURL } from 'nuxt/server'
import { resolvePublicOrigin } from '~~/server/utils/auth-hosts'

export function resolveRequestPublicOrigin(event: RequestEvent): string {
  const config = useRuntimeConfig()

  return resolvePublicOrigin(
    getRequestURL(event),
    String(config.public.baseUrl ?? ''),
    String(config.authAdditionalAllowedHosts ?? ''),
  )
}
