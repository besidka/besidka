import { GOOGLE_BYO_FEATURE_FLAG } from '#shared/utils/google-byo'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type {
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
import { createFeatureUnavailableError } from '~~/server/utils/features/guards'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import type { GoogleRateLimitBucket } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import type { RequestEvent } from 'nuxt/server'

type DbClient = ReturnType<typeof useDb>

export interface GoogleByoFeatureState {
  rules: FeatureRules
  userState: FeatureUserState | null
  userId: number | null
}

export interface GoogleByoAccessInput {
  db: DbClient
  userId: number
  kv?: FeatureKv
  logger?: LoggerLike
  featureState?: GoogleByoFeatureState
  requiredFlags?: readonly string[]
}

export type GoogleByoAccessVerdict = 'allowed' | 'not-admin' | 'flag-off'

function sendFeatureStateOf(
  input: GoogleByoAccessInput,
): GoogleByoFeatureState | null {
  return input.featureState?.userId === input.userId
    ? input.featureState
    : null
}

/**
 * The one gate of the bring-your-own Google client. It needs both: the
 * user is an admin right now (verified email, 2FA outside dev and CI, the
 * `admin` role or an env admin email), and `google.byo` is active for the
 * user (the flag and its parents resolved, and the Labs opt-in on), plus
 * every flag in `requiredFlags` (`google.gmail` for a Gmail tool call). A
 * flag grant or a tester role alone is never enough. It runs without a
 * request, so the start and callback routes, the code exchange, every token
 * refresh and every later tool share it. `featureState` lets a send reuse
 * the rules and user state it already loaded for this user (no extra D1
 * read); without it, one fresh load serves every flag checked.
 */
export async function checkGoogleByoAccess(
  input: GoogleByoAccessInput,
): Promise<GoogleByoAccessVerdict> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    return 'not-admin'
  }

  const config = getFeatureEvaluationConfig()
  const sendState = sendFeatureStateOf(input)
  const userState = sendState
    ? sendState.userState
    : await loadUserFeatureState(input.db, input.userId)

  if (!isAdminUser(userState, config)) {
    return 'not-admin'
  }

  const rules = sendState?.rules
    ?? await loadFeatureRules(input.kv ?? useKV(), input.db, input.logger)

  for (const flag of [GOOGLE_BYO_FEATURE_FLAG, ...input.requiredFlags ?? []]) {
    const resolution = await evaluateFeature(flag, { rules, userState, config })

    if (!isFeatureActive(flag, resolution, userState)) {
      return 'flag-off'
    }
  }

  return 'allowed'
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
