import type { RequestEvent } from 'nuxt/server'
import type {
  FeatureEventResolution,
  FeatureRequestContext,
} from '~~/server/utils/features/context'
import { createError } from 'evlog'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import {
  evaluateFeatureForEvent,
  useFeatureContext,
} from '~~/server/utils/features/context'

export const FEATURE_UNAVAILABLE_WHY = 'feature_unavailable'

type FeatureEvent = Pick<RequestEvent, 'context'>

export function createFeatureUnavailableError() {
  return createError({
    message: 'Not found',
    status: 404,
    why: FEATURE_UNAVAILABLE_WHY,
  })
}

/**
 * Throws a 404 unless the caller has `flag`. For a feature that needs an
 * opt-in (it spends the user's keys) the caller must also be opted in,
 * unless `active: false` is passed, as the opt-in route itself does. A 404
 * keeps unreleased features invisible; the client-side `useFeature` check
 * only hides UI.
 */
export async function requireFeature(
  event: FeatureEvent,
  flag: string,
  options: { active?: boolean } = {},
): Promise<FeatureEventResolution> {
  const resolution = await evaluateFeatureForEvent(event, flag)
  const requireActive = options.active
    ?? getFeatureDefinition(flag)?.optIn === 'required'
  const allowed = requireActive ? resolution.active : resolution.value

  if (!allowed) {
    throw createFeatureUnavailableError()
  }

  return resolution
}

export async function requireAdmin(
  event: FeatureEvent,
): Promise<FeatureRequestContext> {
  const context = await useFeatureContext(event)

  if (context.userId === null) {
    useUnauthorizedError()
  }

  if (!context.isAdmin) {
    throw createFeatureUnavailableError()
  }

  return context
}
