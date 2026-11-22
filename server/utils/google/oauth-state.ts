import type { KVNamespace } from '@cloudflare/workers-types'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import { isWellFormedOAuthState } from '~~/server/utils/connectors/oauth-state'

export const GOOGLE_OAUTH_STATE_KEY_PREFIX = 'google:oauth:'
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 600

export interface GoogleOAuthState {
  userId: number
  clientMode: GoogleClientMode
  codeVerifier: string
  redirectUri: string
  returnTo: string
  forcedConsent: boolean
  createdAt: number
}

function stateKey(state: string): string {
  return `${GOOGLE_OAUTH_STATE_KEY_PREFIX}${state}`
}

/**
 * Stores a pending Google connection under `google:oauth:<state>` for ten
 * minutes, encrypted because it holds the PKCE verifier.
 */
export async function saveGoogleOAuthState(
  kv: KVNamespace,
  state: string,
  value: GoogleOAuthState,
): Promise<void> {
  await kv.put(
    stateKey(state),
    await useEncryptText(JSON.stringify(value)),
    { expirationTtl: GOOGLE_OAUTH_STATE_TTL_SECONDS },
  )
}

function isGoogleOAuthState(value: unknown): value is GoogleOAuthState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate.userId === 'number'
    && (candidate.clientMode === 'besidka' || candidate.clientMode === 'byo')
    && typeof candidate.codeVerifier === 'string'
    && typeof candidate.redirectUri === 'string'
    && typeof candidate.returnTo === 'string'
    && typeof candidate.forcedConsent === 'boolean'
    && typeof candidate.createdAt === 'number'
}

/**
 * Reads and deletes a pending connection. The delete comes before the value
 * is used, so a replayed callback finds nothing; KV has no atomic
 * read-and-delete, so Google's single-use code is the backstop for two
 * callbacks racing in different locations. An entry older than the TTL is
 * refused even if KV still returns it. The caller checks the user.
 */
export async function consumeGoogleOAuthState(
  kv: KVNamespace,
  state: string,
  now: number = Date.now(),
): Promise<GoogleOAuthState | null> {
  if (!isWellFormedOAuthState(state)) {
    return null
  }

  const key = stateKey(state)
  const stored = await kv.get(key)

  if (!stored) {
    return null
  }

  await kv.delete(key)

  let value: unknown

  try {
    value = JSON.parse(await useDecryptText(stored))
  } catch {
    return null
  }

  if (!isGoogleOAuthState(value)) {
    return null
  }

  const ageMs = now - value.createdAt

  if (
    !Number.isFinite(ageMs)
    || ageMs < 0
    || ageMs > GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000
  ) {
    return null
  }

  return value
}
