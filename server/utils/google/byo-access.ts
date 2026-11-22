import { GOOGLE_BYO_FEATURE_FLAG } from '#shared/utils/google-byo'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isAdminUser,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { createFeatureUnavailableError } from '~~/server/utils/features/guards'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import type { GoogleRateLimitBucket } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import type { RequestEvent } from 'nuxt/server'

type DbClient = ReturnType<typeof useDb>

export interface GoogleByoAccessInput {
  db: DbClient
  userId: number
  kv?: FeatureKv
  logger?: LoggerLike
}

export type GoogleByoAccessVerdict = 'allowed' | 'not-admin' | 'flag-off'

/**
 * The one gate of the bring-your-own Google client. It needs both: the
 * user is an admin right now (verified email, 2FA outside dev and CI, the
 * `admin` role or an env admin email), and `google.byo` is active for the
 * user (the flag and its parents resolved, and the Labs opt-in on). A flag
 * grant or a tester role alone is never enough. It runs without a request,
 * so the start and callback routes, the code exchange, every token refresh
 * and every later tool share it.
 */
export async function checkGoogleByoAccess(
  input: GoogleByoAccessInput,
): Promise<GoogleByoAccessVerdict> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    return 'not-admin'
  }

  const config = getFeatureEvaluationConfig()
  const userState = await loadUserFeatureState(input.db, input.userId)

  if (!isAdminUser(userState, config)) {
    return 'not-admin'
  }

  const rules = await loadFeatureRules(
    input.kv ?? useKV(),
    input.db,
    input.logger,
  )
  const resolution = await evaluateFeature(GOOGLE_BYO_FEATURE_FLAG, {
    rules,
    userState,
    config,
  })

  return isFeatureActive(GOOGLE_BYO_FEATURE_FLAG, resolution, userState)
    ? 'allowed'
    : 'flag-off'
}

export async function isGoogleByoAllowed(
  input: GoogleByoAccessInput,
): Promise<boolean> {
  return await checkGoogleByoAccess(input) === 'allowed'
}

/**
 * Throws the same 404 as an unavailable feature unless
 * `checkGoogleByoAccess` allows the user, so the bring-your-own client
 * stays invisible to everyone else. Logs the verdict only.
 */
export async function assertGoogleByoAllowed(
  input: GoogleByoAccessInput,
): Promise<void> {
  const verdict = await checkGoogleByoAccess(input)

  if (verdict === 'allowed') {
    return
  }

  input.logger?.set({
    attributes: { google: { byoGate: verdict } },
  })

  throw createFeatureUnavailableError()
}

/**
 * The route gate of every bring-your-own route: `requireGoogleAccess`
 * (same-origin guard, session, rate limit) with the admin and
 * `google.byo` check in place of the `google.drive` flag. Returns the
 * user id.
 */
export async function requireGoogleByoAccess(
  event: RequestEvent,
  options: {
    write: boolean
    rateLimit: GoogleRateLimitBucket
    navigation?: boolean
  },
): Promise<number> {
  const logger = useRequestLogger(event)

  return await requireGoogleAccess(event, {
    ...options,
    feature: false,
    authorize: async (userId) => {
      await assertGoogleByoAllowed({ db: useDb(), userId, logger })
    },
  })
}
