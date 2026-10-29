import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'

export function resolveSiteOrigin(event: H3Event): string {
  const { baseUrl } = useRuntimeConfig(event).public

  if (typeof baseUrl === 'string' && baseUrl) {
    return new URL(baseUrl).origin
  }

  return getRequestURL(event).origin
}
