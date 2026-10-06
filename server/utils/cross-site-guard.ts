import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'

export function assertNotCrossSiteRequest(event: RequestEvent): void {
  const secFetchSite = getRequestHeader(event, 'sec-fetch-site')

  if (secFetchSite === 'cross-site') {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `sec-fetch-site "${secFetchSite}" is cross-site`,
    })
  }
}
