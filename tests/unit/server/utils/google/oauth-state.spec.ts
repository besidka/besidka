import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeGoogleOAuthState,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
  saveGoogleOAuthState,
} from '~~/server/utils/google/oauth-state'
import type { GoogleOAuthState } from '~~/server/utils/google/oauth-state'
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../../../setup/helpers/connectors-oauth'

const STATE = 'abcdefghijklmnopqrstuvwxyz012345'
const NOW = 1_700_000_000_000

function stateValue(overrides: Partial<GoogleOAuthState> = {}) {
  return {
    userId: 7,
    clientMode: 'besidka' as const,
    codeVerifier: 'verifier',
    redirectUri: 'https://besidka.com/api/v1/google/oauth/callback',
    returnTo: '/profile/keys?tab=google',
    forcedConsent: false,
    createdAt: NOW,
    ...overrides,
  }
}

describe('Google OAuth state', () => {
  let kv: ReturnType<typeof createFakeConnectorKv>

  beforeEach(() => {
    kv = createFakeConnectorKv()
    vi.stubGlobal('useEncryptText', async (plain: string) => fakeEncrypt(plain))
    vi.stubGlobal('useDecryptText', async (cipher: string) => {
      return fakeDecrypt(cipher)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the state encrypted for ten minutes', async () => {
    await saveGoogleOAuthState(kv as never, STATE, stateValue())

    const key = `google:oauth:${STATE}`

    expect(kv.ttls.get(key)).toBe(GOOGLE_OAUTH_STATE_TTL_SECONDS)
    expect(kv.values.get(key)).not.toContain('verifier')
  })

  it('is single use', async () => {
    await saveGoogleOAuthState(kv as never, STATE, stateValue())

    expect(await consumeGoogleOAuthState(kv as never, STATE, NOW))
      .toEqual(stateValue())
    expect(await consumeGoogleOAuthState(kv as never, STATE, NOW))
      .toBeNull()
  })

  it('refuses an expired state and still deletes it', async () => {
    await saveGoogleOAuthState(kv as never, STATE, stateValue())

    const later = NOW + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000 + 1

    expect(await consumeGoogleOAuthState(kv as never, STATE, later))
      .toBeNull()
    expect(kv.values.size).toBe(0)
  })

  it('refuses a malformed state without reading KV', async () => {
    expect(await consumeGoogleOAuthState(kv as never, 'short', NOW))
      .toBeNull()
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('refuses a stored value of the wrong shape', async () => {
    kv.values.set(`google:oauth:${STATE}`, fakeEncrypt('{"userId":"7"}'))

    expect(await consumeGoogleOAuthState(kv as never, STATE, NOW))
      .toBeNull()
  })
})
