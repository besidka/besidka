import type { H3EventContext } from 'h3'
import type { RequestEvent } from 'nuxt/server'
import type {
  FeatureEvaluationConfig,
  FeatureResolution,
  FeatureRules,
  FeatureUserState,
} from '~~/server/utils/features/provider'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isAdminUser,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { recordFeatureExposure } from '~~/server/utils/features/exposure'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export interface FeatureRequestContext {
  userId: number | null
  rules: FeatureRules
  userState: FeatureUserState | null
  config: FeatureEvaluationConfig
  isAdmin: boolean
  exposures: Set<string>
}

export interface FeatureEventResolution extends FeatureResolution {
  active: boolean
}

type FeatureEvent = Pick<RequestEvent, 'context'>

function readEventContext(event: FeatureEvent): H3EventContext {
  return event.context as H3EventContext
}

async function resolveSessionUserId(
  event: FeatureEvent,
): Promise<number | null> {
  const session = readEventContext(event).authSession
    ?? await useUserSession()
  const userId = Number(session?.user.id ?? Number.NaN)

  return Number.isSafeInteger(userId) && userId > 0 ? userId : null
}

async function createFeatureRequestContext(
  event: FeatureEvent,
): Promise<FeatureRequestContext> {
  const db = useDb()
  const kv = useKV()
  const config = getFeatureEvaluationConfig()
  const userId = await resolveSessionUserId(event)
  const [rules, userState] = await Promise.all([
    loadFeatureRules(kv, db, useRequestLogger(event)),
    userId === null ? null : loadUserFeatureState(db, userId),
  ])

  return {
    userId: userState ? userId : null,
    rules,
    userState,
    config,
    isAdmin: isAdminUser(userState, config),
    exposures: new Set<string>(),
  }
}

/**
 * Loads the rules (KV, D1 on a miss) and the signed-in user's feature state
 * (one D1 batch) once per request and memoises them on
 * `event.context.features`, so every guard and the features endpoint in the
 * same request share them.
 */
export function useFeatureContext(
  event: FeatureEvent,
): Promise<FeatureRequestContext> {
  const context = readEventContext(event)

  context.features ??= createFeatureRequestContext(event)

  return context.features
}

export async function evaluateFeatureForEvent(
  event: FeatureEvent,
  flag: string,
  options: { recordExposure?: boolean } = {},
): Promise<FeatureEventResolution> {
  const context = await useFeatureContext(event)
  const resolution = await evaluateFeature(flag, context)

  if (options.recordExposure !== false) {
    recordFeatureExposure({
      flag,
      resolution,
      recorded: context.exposures,
      analytics: useAnalytics(),
      logger: useRequestLogger(event),
    })
  }

  return {
    ...resolution,
    active: isFeatureActive(flag, resolution, context.userState),
  }
}
