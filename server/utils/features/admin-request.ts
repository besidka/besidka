import type { RequestEvent } from 'nuxt/server'
import type { FeatureRequestContext } from '~~/server/utils/features/context'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import { createError } from 'evlog'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Builds the write context for an admin route that already passed
 * `requireAdmin`: rejects cross-site requests, and captures the database,
 * KV, the acting admin and the rollout switch.
 */
export function createFeatureAdminWriteContext(
  event: RequestEvent,
  adminContext: FeatureRequestContext,
): FeatureAdminContext {
  assertNotCrossSiteRequest(event)

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
