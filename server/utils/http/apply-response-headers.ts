import type { RequestEvent } from 'nuxt/server'

export function applyResponseHeaders(
  event: RequestEvent,
  headers: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
}
