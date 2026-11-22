import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../../../setup/helpers/connectors-oauth'
import type { FakeConnectorKv } from '../../../../setup/helpers/connectors-oauth'
import {
  consumeConnectorOAuthState,
  isWellFormedOAuthState,
  saveConnectorOAuthState,
} from '~~/server/utils/connectors/oauth-state'
import type { ConnectorOAuthState } from '~~/server/utils/connectors/oauth-state'

const STATE = 'a'.repeat(43)
const NOW = 1_800_000_000_000

function pendingState(createdAt = NOW): ConnectorOAuthState {
  return {
    userId: 1,
    connectorId: 'skl1',
    codeVerifier: 'verifier-secret',
    issuer: 'https://auth.example.com',
    issParameterRequired: true,
    resource: 'https://mcp.example.com/mcp',
    requestedScope: 'read',
    redirectUri: 'https://besidka.com/api/v1/connectors/oauth/callback',
    registration: { clientId: 'client', registrationKind: 'cimd' },
    createdAt,
  }
}

describe('connector OAuth state', () => {
  let kv: FakeConnectorKv

  beforeEach(() => {
    kv = createFakeConnectorKv()
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the state encrypted for ten minutes', async () => {
    await saveConnectorOAuthState(kv as never, STATE, pendingState())

    const key = `connectors:oauth:${STATE}`

    expect(kv.ttls.get(key)).toBe(600)
    expect(kv.values.get(key)).not.toContain('verifier-secret')
  })

  it('is single use', async () => {
    await saveConnectorOAuthState(kv as never, STATE, pendingState())

    expect(await consumeConnectorOAuthState(kv as never, STATE, NOW))
      .toMatchObject({ codeVerifier: 'verifier-secret' })
    expect(await consumeConnectorOAuthState(kv as never, STATE, NOW))
      .toBeNull()
  })

  it('refuses an entry older than the TTL even if KV still has it',
    async () => {
      await saveConnectorOAuthState(kv as never, STATE, pendingState())

      expect(await consumeConnectorOAuthState(
        kv as never,
        STATE,
        NOW + 601 * 1000,
      )).toBeNull()
      expect(kv.values.size).toBe(0)
    })

  it('refuses a state created in the future', async () => {
    await saveConnectorOAuthState(
      kv as never,
      STATE,
      pendingState(NOW + 60_000),
    )

    expect(await consumeConnectorOAuthState(kv as never, STATE, NOW))
      .toBeNull()
  })

  it.each([
    ['short', 'abc'],
    ['with a colon', `${'a'.repeat(20)}:x`],
    ['too long', 'a'.repeat(129)],
  ])('ignores a malformed state (%s) without reading KV', async (_label, state) => {
    expect(isWellFormedOAuthState(state)).toBe(false)
    expect(await consumeConnectorOAuthState(kv as never, state, NOW)).toBeNull()
    expect(kv.get).not.toHaveBeenCalled()
  })
})
