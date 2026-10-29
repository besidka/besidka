import type { RequestEvent } from 'nuxt/server'

export function getSiteOrigin(event: RequestEvent): string {
  const { baseUrl } = useRuntimeConfig().public

  return ((baseUrl as string) || event.url.origin).replace(/\/+$/, '')
}

export function getSiteHostname(event: RequestEvent): string {
  return new URL(getSiteOrigin(event)).hostname
}
