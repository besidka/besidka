import type { RequestEvent } from 'nuxt/server'
import type { FeatureRequestContext } from '~~/server/utils/features/context'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import { createError } from 'evlog'
import { getRequestHeader, getRequestURL } from 'nuxt/server'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin', 'none'])

function throwForeignOrigin(why: string): never {
  throw createError({
    message: 'Forbidden',
    status: 403,
    why,
  })
}

/**
 * Admin writes accept only same-origin browser requests: a `same-site`
 * sibling host is refused too, and without `Sec-Fetch-Site` an `Origin`
 * must match this host. Clients that send neither header (curl, server-side
 * tests) carry no browser cookies to forge, so they pass.
 */
export function assertSameOriginAdminRequest(event: RequestEvent): void {
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')

  if (fetchSite) {
    if (!SAME_ORIGIN_FETCH_SITES.has(fetchSite)) {
      throwForeignOrigin(`sec-fetch-site "${fetchSite}" is not same-origin`)
    }

    return
  }

  const origin = getRequestHeader(event, 'origin')

  if (origin && origin !== getRequestURL(event).origin) {
    throwForeignOrigin('origin does not match the request host')
  }
}

/**
 * Builds the write context for an admin route that already passed
 * `requireAdmin`: rejects requests that are not same-origin, and captures
 * the database, KV, the acting admin and the rollout switch.
 */
export function createFeatureAdminWriteContext(
  event: RequestEvent,
  adminContext: FeatureRequestContext,
): FeatureAdminContext {
  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

  return {
    db: useDb(),
    kv: useKV(),
    actor: { userId: adminContext.userId, kind: 'ui' },
    rolloutEnabled: adminContext.config.featuresRolloutEnabled,
    logger: useRequestLogger(event),
  }
}

export function readAdminFlagParam(event: RequestEvent): string {
  const params = z.object({
    flag: z.string().trim().min(1).max(100),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  return params.data.flag
}

export function readAdminIdParam(event: RequestEvent): number {
  const params = z.object({
    id: z.coerce.number().int().positive(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  return params.data.id
}

export function throwInvalidAdminBody(message: string): never {
  throw createError({
    message: 'Invalid request body',
    status: 400,
    why: message,
  })
}
