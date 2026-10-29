import type { RequestEvent } from 'nuxt/server'

export function getSiteOrigin(event: RequestEvent): string {
  const { baseUrl } = useRuntimeConfig().public

  return ((baseUrl as string) || event.url.origin).replace(/\/+$/, '')
}

export function getSiteHostname(event: RequestEvent): string {
  return new URL(getSiteOrigin(event)).hostname
}

export function getSiteDidWebIdentifier(event: RequestEvent): string {
  const { host } = new URL(getSiteOrigin(event))

  return `did:web:${host.replace(':', '%3A')}`
}
