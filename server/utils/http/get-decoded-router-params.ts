import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRouterParams } from 'nuxt/server'

export function getDecodedRouterParams(
  event: RequestEvent,
): Record<string, string> {
  try {
    return getRouterParams(event, { decode: true }) as Record<string, string>
  } catch (exception) {
    if (exception instanceof URIError) {
      throw createError({
        message: 'Invalid route parameter',
        status: 400,
        why: 'A route parameter contains malformed percent-encoding',
        fix: 'Percent-encode the route parameter correctly',
      })
    }

    throw exception
  }
}
