import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { JWK, JWTPayload, KeyObject } from 'jose'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import {
  MCP_JWKS_GRACE_PERIOD_MS,
  buildMcpBearerChallenge,
  evaluateMcpOpaqueAccessToken,
  hasBearerScheme,
  hashMcpOpaqueAccessToken,
  isMcpPrincipalActive,
  parseBearerToken,
  parseMcpScopes,
  parseMcpUserId,
  resolveMcpResourceMetadataUrl,
  resolveMcpResourceUrl,
  toMcpJsonWebKeySet,
  verifyMcpAccessToken,
} from '~~/server/utils/mcp/auth'
import type {
  McpOpaqueAccessTokenRow,
  McpTokenVerifierDependencies,
} from '~~/server/utils/mcp/auth'

const ISSUER = 'https://besidka.com'
const AUDIENCE = 'https://besidka.com/mcp'
const KEY_ID = '7'

let privateKey: KeyObject | CryptoKey
let publicJwk: JWK
let otherPrivateKey: KeyObject | CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  const other = await generateKeyPair('EdDSA', { extractable: true })

  privateKey = pair.privateKey
  otherPrivateKey = other.privateKey
  publicJwk = await exportJWK(pair.publicKey)
})

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

async function signToken(
  overrides: JWTPayload = {},
  options: {
    kid?: string
    key?: KeyObject | CryptoKey
    typ?: string | null
  } = {},
): Promise<string> {
  const payload: JWTPayload = {
    sub: '42',
    azp: 'client-abc',
    client_id: 'client-abc',
    scope: 'openid chats:read memory:read',
    iss: ISSUER,
    aud: [AUDIENCE, `${ISSUER}/api/auth/oauth2/userinfo`],
    iat: nowSeconds(),
    exp: nowSeconds() + 900,
    ...overrides,
  }

  return await new SignJWT(payload)
    .setProtectedHeader({
      alg: 'EdDSA',
      ...(options.typ === null ? {} : { typ: options.typ ?? 'at+jwt' }),
      kid: options.kid ?? KEY_ID,
    })
    .sign(options.key ?? privateKey)
}

function createDependencies(
  overrides: Partial<McpTokenVerifierDependencies> = {},
): McpTokenVerifierDependencies {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
    loadJwks: async () => {
      return toMcpJsonWebKeySet([{
        id: Number(KEY_ID),
        publicKey: JSON.stringify(publicJwk),
        alg: 'EdDSA',
        crv: 'Ed25519',
        expiresAt: null,
      }])
    },
    findOpaqueAccessToken: async () => {
      return null
    },
    isPrincipalActive: async () => {
      return true
    },
    jwksCacheKey: {},
    ...overrides,
  }
}

async function verify(
  token: string,
  overrides: Partial<McpTokenVerifierDependencies> = {},
) {
  return await verifyMcpAccessToken(
    `Bearer ${token}`,
    createDependencies(overrides),
  )
}

describe('verifyMcpAccessToken', () => {
  it('accepts a valid token and returns user, client and scopes', async () => {
    const isPrincipalActive = vi.fn(async () => {
      return true
    })
    const result = await verify(await signToken(), { isPrincipalActive })

    expect(result).toEqual({
      status: 'valid',
      auth: {
        userId: 42,
        clientId: 'client-abc',
        scopes: ['openid', 'chats:read', 'memory:read'],
      },
    })
    expect(isPrincipalActive).toHaveBeenCalledWith(42, 'client-abc')
  })

  it('rejects a token for another audience', async () => {
    const token = await signToken({ aud: 'https://besidka.com/other' })

    await expect(verify(token)).resolves.toMatchObject({ status: 'invalid' })
  })

  it('rejects a token from another issuer', async () => {
    const token = await signToken({ iss: 'https://evil.example' })

    await expect(verify(token)).resolves.toMatchObject({ status: 'invalid' })
  })

  it('rejects an expired token', async () => {
    const token = await signToken({
      iat: nowSeconds() - 3600,
      exp: nowSeconds() - 60,
    })

    await expect(verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'expired',
    })
  })

  it('rejects a token signed with an unknown key', async () => {
    const token = await signToken({}, { kid: '99', key: otherPrivateKey })

    await expect(verify(token)).resolves.toMatchObject({ status: 'invalid' })
  })

  it('rejects a token signed by another key under a known kid', async () => {
    const token = await signToken({}, { key: otherPrivateKey })

    await expect(verify(token)).resolves.toMatchObject({ status: 'invalid' })
  })

  it('rejects a token without azp', async () => {
    const token = await signToken({ azp: undefined, client_id: undefined })

    await expect(verify(token)).resolves.toMatchObject({ status: 'invalid' })
  })

  it('rejects a subject that is not a user id', async () => {
    const token = await signToken({ sub: 'client-abc' })

    await expect(verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'subject',
    })
  })

  it('pins the token type to at+jwt', async () => {
    for (const typ of ['JWT', 'id_token+jwt', 'logout+jwt']) {
      await expect(verify(await signToken({}, { typ }))).resolves.toEqual({
        status: 'invalid',
        reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      })
    }

    await expect(verify(await signToken({}, { typ: null }))).resolves
      .toMatchObject({ status: 'invalid' })
    await expect(verify(await signToken({}, { typ: 'AT+JWT' }))).resolves
      .toMatchObject({ status: 'valid' })
    await expect(verify(await signToken({}, { typ: 'application/at+jwt' })))
      .resolves.toMatchObject({ status: 'valid' })
  })

  it('rejects a token whose subject is its own client', async () => {
    const token = await signToken({ sub: '42', azp: '42', client_id: '42' })

    await expect(verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'subject',
    })
  })

  it('rejects a sender-constrained (DPoP) token', async () => {
    const token = await signToken({ cnf: { jkt: 'thumbprint' } })

    await expect(verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'sender-constrained',
    })
  })

  it('rejects a token whose user or client is gone', async () => {
    const result = await verify(await signToken(), {
      isPrincipalActive: async () => {
        return false
      },
    })

    expect(result).toEqual({ status: 'invalid', reason: 'principal' })
  })

  it('reports unavailable when the key set cannot be loaded', async () => {
    const result = await verify(await signToken(), {
      loadJwks: async () => {
        throw new Error('D1 down')
      },
    })

    expect(result).toEqual({ status: 'unavailable', reason: 'jwks' })
  })

  it('reports unavailable when the principal lookup fails', async () => {
    const result = await verify(await signToken(), {
      isPrincipalActive: async () => {
        throw new Error('D1 down')
      },
    })

    expect(result).toEqual({ status: 'unavailable', reason: 'principal' })
  })

  it('rejects a malformed token and a non-Bearer scheme', async () => {
    await expect(verify('not-a-jwt')).resolves.toMatchObject({
      status: 'invalid',
    })
    await expect(verifyMcpAccessToken(
      `DPoP ${await signToken()}`,
      createDependencies(),
    )).resolves.toEqual({ status: 'invalid', reason: 'scheme' })
  })
})

const OPAQUE_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf'

function opaqueRow(
  overrides: Partial<McpOpaqueAccessTokenRow> = {},
): McpOpaqueAccessTokenRow {
  return {
    userId: 42,
    clientId: 'client-abc',
    scopes: ['openid', 'projects:read'],
    resources: [AUDIENCE],
    expiresAt: new Date(Date.now() + 900_000),
    revoked: null,
    confirmation: null,
    sessionId: 5,
    sessionExpiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  }
}

describe('verifyMcpAccessToken with an opaque token', () => {
  it('looks the token up by its hash and accepts a live row', async () => {
    const findOpaqueAccessToken = vi.fn(async () => {
      return opaqueRow()
    })
    const loadJwks = vi.fn()
    const result = await verify(OPAQUE_TOKEN, {
      findOpaqueAccessToken,
      loadJwks,
    })

    expect(result).toEqual({
      status: 'valid',
      auth: {
        userId: 42,
        clientId: 'client-abc',
        scopes: ['openid', 'projects:read'],
      },
    })
    expect(findOpaqueAccessToken).toHaveBeenCalledWith(
      await hashMcpOpaqueAccessToken(OPAQUE_TOKEN),
    )
    expect(loadJwks).not.toHaveBeenCalled()
  })

  it('rejects an unknown opaque token', async () => {
    await expect(verify(OPAQUE_TOKEN)).resolves.toEqual({
      status: 'invalid',
      reason: 'unknown-token',
    })
  })

  it('reports unavailable when the lookup fails', async () => {
    const result = await verify(OPAQUE_TOKEN, {
      findOpaqueAccessToken: async () => {
        throw new Error('D1 down')
      },
    })

    expect(result).toEqual({ status: 'unavailable', reason: 'opaque-token' })
  })

  it('still checks the user and the client', async () => {
    const result = await verify(OPAQUE_TOKEN, {
      findOpaqueAccessToken: async () => {
        return opaqueRow()
      },
      isPrincipalActive: async () => {
        return false
      },
    })

    expect(result).toEqual({ status: 'invalid', reason: 'principal' })
  })
})

describe('evaluateMcpOpaqueAccessToken', () => {
  const options = { audience: AUDIENCE, now: Date.now() }

  it.each([
    ['revoked', { revoked: new Date() }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['sender-constrained', { confirmation: { jkt: 'x' } }],
    ['session', { sessionExpiresAt: new Date(Date.now() - 1000) }],
    ['session', { sessionExpiresAt: null }],
    ['audience', { resources: ['https://besidka.com/other'] }],
    ['audience', { resources: 'https://besidka.com/mcp' }],
    ['subject', { userId: null }],
    ['scope', { scopes: 'projects:read' }],
  ] as const)('rejects with %s', (reason, overrides) => {
    expect(evaluateMcpOpaqueAccessToken(
      opaqueRow(overrides as Partial<McpOpaqueAccessTokenRow>),
      options,
    )).toEqual({ status: 'invalid', reason })
  })

  it('accepts a token with no resources and one without a session', () => {
    expect(evaluateMcpOpaqueAccessToken(
      opaqueRow({ resources: null }),
      options,
    )).toMatchObject({ status: 'claims' })
    expect(evaluateMcpOpaqueAccessToken(
      opaqueRow({ resources: [], sessionId: null, sessionExpiresAt: null }),
      options,
    )).toMatchObject({ status: 'claims' })
  })

  it('hashes like the provider: base64url SHA-256 without padding',
    async () => {
      await expect(hashMcpOpaqueAccessToken('abc')).resolves
        .toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
    })
})

describe('toMcpJsonWebKeySet', () => {
  it('uses the row id as kid and keeps keys inside the grace period', () => {
    const now = Date.UTC(2026, 9, 29)
    const keySet = toMcpJsonWebKeySet([
      {
        id: 1,
        publicKey: JSON.stringify({ kty: 'OKP', x: 'a' }),
        alg: null,
        crv: 'Ed25519',
        expiresAt: null,
      },
      {
        id: 2,
        publicKey: JSON.stringify({ kty: 'OKP', x: 'b' }),
        alg: 'EdDSA',
        crv: null,
        expiresAt: new Date(now - MCP_JWKS_GRACE_PERIOD_MS + 1000),
      },
      {
        id: 3,
        publicKey: JSON.stringify({ kty: 'OKP', x: 'c' }),
        alg: 'EdDSA',
        crv: null,
        expiresAt: new Date(now - MCP_JWKS_GRACE_PERIOD_MS - 1000),
      },
      {
        id: 4,
        publicKey: '{not json',
        alg: 'EdDSA',
        crv: null,
        expiresAt: null,
      },
    ], now)

    expect(keySet.keys).toEqual([
      { alg: 'EdDSA', crv: 'Ed25519', kty: 'OKP', x: 'a', kid: '1' },
      { alg: 'EdDSA', kty: 'OKP', x: 'b', kid: '2' },
    ])
  })
})

describe('toMcpJsonWebKeySet retired key grace', () => {
  it('covers the access token lifetime and no more than a day', () => {
    const accessTokenLifetimeMs = 15 * 60 * 1000

    expect(MCP_JWKS_GRACE_PERIOD_MS).toBeGreaterThan(accessTokenLifetimeMs)
    expect(MCP_JWKS_GRACE_PERIOD_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })

  it('drops a key retired more than a day ago', () => {
    const now = Date.UTC(2026, 9, 29)
    const keySet = toMcpJsonWebKeySet([{
      id: 1,
      publicKey: JSON.stringify({ kty: 'OKP', x: 'a' }),
      alg: 'EdDSA',
      crv: null,
      expiresAt: new Date(now - 25 * 60 * 60 * 1000),
    }, {
      id: 2,
      publicKey: JSON.stringify({ kty: 'OKP', x: 'b' }),
      alg: 'EdDSA',
      crv: null,
      expiresAt: new Date(now - 20 * 60 * 1000),
    }], now)

    expect(keySet.keys.map(key => key.kid)).toEqual(['2'])
  })
})

describe('isMcpPrincipalActive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubDatabase(rows: {
    users: unknown[]
    clients: unknown[]
    consents: unknown[]
  }) {
    const tables: unknown[] = []
    const chain = {
      from: (table: unknown) => {
        tables.push(table)

        return chain
      },
      where: () => chain,
      limit: () => chain,
    }
    const batch = vi.fn(async (queries: unknown[]) => {
      expect(queries).toHaveLength(3)

      return [rows.users, rows.clients, rows.consents]
    })

    vi.stubGlobal('useDb', () => {
      return { select: () => chain, batch }
    })

    return { batch, tables }
  }

  it('is active with a user, an enabled client and a live consent',
    async () => {
      const { batch, tables } = stubDatabase({
        users: [{ id: 42 }],
        clients: [{ disabled: false }],
        consents: [{ id: 'consent-1' }],
      })

      await expect(isMcpPrincipalActive(42, 'client-abc')).resolves.toBe(true)
      expect(batch).toHaveBeenCalledTimes(1)
      expect(tables).toHaveLength(3)
    })

  it('is inactive once the consent is gone, even for a live token',
    async () => {
      stubDatabase({
        users: [{ id: 42 }],
        clients: [{ disabled: false }],
        consents: [],
      })

      await expect(isMcpPrincipalActive(42, 'client-abc')).resolves.toBe(false)
    })

  it('is inactive for a missing user, a missing or disabled client',
    async () => {
      stubDatabase({
        users: [],
        clients: [{ disabled: false }],
        consents: [{ id: 'consent-1' }],
      })
      await expect(isMcpPrincipalActive(42, 'client-abc')).resolves.toBe(false)

      stubDatabase({
        users: [{ id: 42 }],
        clients: [],
        consents: [{ id: 'consent-1' }],
      })
      await expect(isMcpPrincipalActive(42, 'client-abc')).resolves.toBe(false)

      stubDatabase({
        users: [{ id: 42 }],
        clients: [{ disabled: true }],
        consents: [{ id: 'consent-1' }],
      })
      await expect(isMcpPrincipalActive(42, 'client-abc')).resolves.toBe(false)
    })

  it('fails a token for a disconnected app through the verifier', async () => {
    const result = await verify(await signToken(), {
      isPrincipalActive: async () => {
        return false
      },
    })

    expect(result).toEqual({ status: 'invalid', reason: 'principal' })
  })
})

describe('mcp auth helpers', () => {
  it('recognises the Bearer scheme only', () => {
    expect(hasBearerScheme('Bearer abc')).toBe(true)
    expect(hasBearerScheme('bearer\tabc')).toBe(true)
    expect(hasBearerScheme('Bearer')).toBe(true)
    expect(hasBearerScheme('Bearer ')).toBe(true)
    expect(hasBearerScheme('Basic abc')).toBe(false)
    expect(hasBearerScheme('DPoP abc')).toBe(false)
    expect(hasBearerScheme('Bearerabc')).toBe(false)
    expect(hasBearerScheme('')).toBe(false)
    expect(hasBearerScheme(undefined)).toBe(false)
    expect(hasBearerScheme(null)).toBe(false)
  })

  it('parses only Bearer tokens', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(parseBearerToken('bearer abc')).toBe('abc')
    expect(parseBearerToken('Basic abc')).toBeNull()
    expect(parseBearerToken('Bearer')).toBeNull()
    expect(parseBearerToken(undefined)).toBeNull()
  })

  it('parses user ids strictly', () => {
    expect(parseMcpUserId('42')).toBe(42)
    expect(parseMcpUserId(42)).toBe(42)
    expect(parseMcpUserId('042')).toBeNull()
    expect(parseMcpUserId('0')).toBeNull()
    expect(parseMcpUserId('-1')).toBeNull()
    expect(parseMcpUserId('1e3')).toBeNull()
    expect(parseMcpUserId(undefined)).toBeNull()
  })

  it('parses scope claims', () => {
    expect(parseMcpScopes('a b  a')).toEqual(['a', 'b'])
    expect(parseMcpScopes(undefined)).toEqual([])
    expect(parseMcpScopes(['a'])).toBeNull()
    expect(parseMcpScopes('a "b')).toBeNull()
  })

  it('derives the resource and its metadata URL from the site URL', () => {
    expect(resolveMcpResourceUrl('https://besidka.com'))
      .toBe('https://besidka.com/mcp')
    expect(resolveMcpResourceMetadataUrl('https://besidka.com'))
      .toBe('https://besidka.com/.well-known/oauth-protected-resource/mcp')
  })

  it('builds RFC 6750 and RFC 9728 challenges', () => {
    const metadata
      = 'https://besidka.com/.well-known/oauth-protected-resource/mcp'

    expect(buildMcpBearerChallenge({
      resourceMetadataUrl: metadata,
      scopes: ['chats:read'],
    })).toBe(`Bearer scope="chats:read", resource_metadata="${metadata}"`)

    expect(buildMcpBearerChallenge({
      resourceMetadataUrl: metadata,
      scopes: ['memory:write'],
      error: 'insufficient_scope',
      description: 'missing "memory:write"',
    })).toBe(
      'Bearer error="insufficient_scope", scope="memory:write", '
      + `resource_metadata="${metadata}", `
      + 'error_description="missing \\"memory:write\\""',
    )
  })
})
