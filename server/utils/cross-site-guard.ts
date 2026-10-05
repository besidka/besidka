import { createError } from 'evlog'
import type { H3Event } from 'h3'

export function assertNotCrossSiteRequest(event: H3Event): void {
  const secFetchSite = getHeader(event, 'sec-fetch-site')

  if (secFetchSite === 'cross-site') {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `sec-fetch-site "${secFetchSite}" is cross-site`,
    })
  }
}
