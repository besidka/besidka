import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  findSupersededClientIds,
  isAuthorizationCodeRedirect,
  parseStoredRedirectUris,
  revokeSupersededClients,
} from '~~/server/utils/oauth/revoke-superseded-clients'
import type {
  OAuthClientIdentity,
} from '~~/server/utils/oauth/revoke-superseded-clients'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const OLDER = new Date('2026-10-01T00:00:00.000Z')
const NEWER = new Date('2026-10-20T00:00:00.000Z')

function identity(
  overrides: Partial<OAuthClientIdentity> = {},
): OAuthClientIdentity {
  return {
    clientId: 'candidate',
    name: 'Claude',
    redirectUris: [CLAUDE_CALLBACK],
    createdAt: OLDER,
    ...overrides,
  }
}

function currentClient(
  overrides: Partial<OAuthClientIdentity> = {},
): OAuthClientIdentity {
  return identity({ clientId: 'current', createdAt: NEWER, ...overrides })
}

describe('parseStoredRedirectUris', () => {
  it('reads an array', () => {
    expect(parseStoredRedirectUris(['https://a.test/cb', 'https://b.test/cb']))
      .toEqual(['https://a.test/cb', 'https://b.test/cb'])
  })

  it('reads a JSON text', () => {
    expect(parseStoredRedirectUris('["https://a.test/cb"]'))
      .toEqual(['https://a.test/cb'])
  })

  it('reads a double-encoded JSON text', () => {
    expect(parseStoredRedirectUris(
      JSON.stringify(JSON.stringify(['https://a.test/cb'])),
    )).toEqual(['https://a.test/cb'])
  })

  it('drops non-string entries and duplicates', () => {
    expect(parseStoredRedirectUris(
      ['https://a.test/cb', 1, null, ' ', 'https://a.test/cb'],
    )).toEqual(['https://a.test/cb'])
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an object', { uri: 'https://a.test/cb' }],
    ['a bare URL string', 'https://a.test/cb'],
    ['broken JSON', '["https://a.test/cb"'],
    ['an empty string', ''],
  ])('returns an empty list for %s', (_label, value) => {
    expect(parseStoredRedirectUris(value)).toEqual([])
  })
})

describe('isAuthorizationCodeRedirect', () => {
  it('accepts a redirect that carries an authorization code', () => {
    expect(isAuthorizationCodeRedirect({
      redirect: true,
      url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s',
    })).toBe(true)
  })

  it('rejects an error redirect', () => {
    expect(isAuthorizationCodeRedirect({
      redirect: true,
      url: 'https://claude.ai/cb?error=access_denied&state=s',
    })).toBe(false)
  })

  it('rejects a redirect carrying both a code and an error', () => {
    expect(isAuthorizationCodeRedirect({
      redirect: true,
      url: 'https://claude.ai/cb?code=abc&error=server_error',
    })).toBe(false)
  })

  it('rejects an empty code and a redirect without one', () => {
    expect(isAuthorizationCodeRedirect({
      redirect: true,
      url: 'https://claude.ai/cb?code=',
    })).toBe(false)
    expect(isAuthorizationCodeRedirect({
      redirect: true,
      url: 'https://besidka.com/signin?client_id=x',
    })).toBe(false)
  })

  it('rejects missing, malformed and non-redirect values', () => {
    expect(isAuthorizationCodeRedirect(undefined)).toBe(false)
    expect(isAuthorizationCodeRedirect(null)).toBe(false)
    expect(isAuthorizationCodeRedirect('https://claude.ai/cb?code=a'))
      .toBe(false)
    expect(isAuthorizationCodeRedirect({ redirect: true })).toBe(false)
    expect(isAuthorizationCodeRedirect({ url: 'https://a.test/?code=a' }))
      .toBe(false)
    expect(isAuthorizationCodeRedirect({ redirect: true, url: 'not a url' }))
      .toBe(false)
    expect(isAuthorizationCodeRedirect({ redirect: true, url: 42 }))
      .toBe(false)
  })
})

describe('findSupersededClientIds', () => {
  it('matches an older client with the same name and redirect URIs', () => {
    expect(findSupersededClientIds(currentClient(), [identity()]))
      .toEqual(['candidate'])
  })

  it('ignores redirect URI order', () => {
    const current = currentClient({
      redirectUris: ['https://a.test/cb', 'https://b.test/cb'],
    })
    const candidate = identity({
      redirectUris: ['https://b.test/cb', 'https://a.test/cb'],
    })

    expect(findSupersededClientIds(current, [candidate]))
      .toEqual(['candidate'])
  })

  it('matches stored redirect URIs in any encoding', () => {
    const candidates = [
      identity({
        clientId: 'text',
        redirectUris: JSON.stringify([CLAUDE_CALLBACK]),
      }),
      identity({
        clientId: 'double',
        redirectUris: JSON.stringify(JSON.stringify([CLAUDE_CALLBACK])),
      }),
    ]

    expect(findSupersededClientIds(currentClient(), candidates))
      .toEqual(['text', 'double'])
  })

  it('ignores case and surrounding whitespace in the name', () => {
    expect(findSupersededClientIds(
      currentClient({ name: '  CLAUDE ' }),
      [identity({ name: 'claude' })],
    )).toEqual(['candidate'])
  })

  it('does not match a different name', () => {
    expect(findSupersededClientIds(
      currentClient(),
      [identity({ name: 'Cursor' })],
    )).toEqual([])
  })

  it.each([null, '', '   '])('never matches the name %j', (name) => {
    expect(findSupersededClientIds(
      currentClient({ name }),
      [identity({ name })],
    )).toEqual([])
    expect(findSupersededClientIds(
      currentClient(),
      [identity({ name })],
    )).toEqual([])
  })

  it('does not match different redirect URIs', () => {
    expect(findSupersededClientIds(
      currentClient(),
      [identity({ redirectUris: ['https://evil.test/cb'] })],
    )).toEqual([])
  })

  it('does not match a subset or a superset of the redirect URIs', () => {
    const current = currentClient({
      redirectUris: ['https://a.test/cb', 'https://b.test/cb'],
    })

    expect(findSupersededClientIds(current, [
      identity({ clientId: 'subset', redirectUris: ['https://a.test/cb'] }),
      identity({
        clientId: 'superset',
        redirectUris: [
          'https://a.test/cb',
          'https://b.test/cb',
          'https://c.test/cb',
        ],
      }),
    ])).toEqual([])
  })

  it('does not match empty or unreadable redirect URI sets', () => {
    expect(findSupersededClientIds(
      currentClient({ redirectUris: [] }),
      [identity({ redirectUris: [] })],
    )).toEqual([])
    expect(findSupersededClientIds(
      currentClient({ redirectUris: 'garbage' }),
      [identity({ redirectUris: 'garbage' })],
    )).toEqual([])
    expect(findSupersededClientIds(
      currentClient(),
      [identity({ redirectUris: { uri: CLAUDE_CALLBACK } })],
    )).toEqual([])
  })

  it('does not match a newer or equally old client', () => {
    expect(findSupersededClientIds(currentClient(), [
      identity({ clientId: 'newer', createdAt: new Date('2026-10-25') }),
      identity({ clientId: 'equal', createdAt: NEWER }),
    ])).toEqual([])
  })

  it('never matches the current client itself', () => {
    expect(findSupersededClientIds(
      currentClient(),
      [identity({ clientId: 'current' })],
    )).toEqual([])
  })
})

describe('revokeSupersededClients', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  async function seedClient(
    clientId: string,
    overrides: Partial<typeof schema.oauthClients.$inferInsert> = {},
  ) {
    await testDb.db.insert(schema.oauthClients).values({
      clientId,
      name: 'Claude',
      redirectUris: [CLAUDE_CALLBACK],
      createdAt: OLDER,
      ...overrides,
    })
  }

  async function seedConsent(userId: number, clientId: string) {
    await testDb.db.insert(schema.oauthConsents).values({
      clientId,
      userId,
      scopes: ['openid', 'chats:read'],
    })
  }

  async function seedRefreshToken(userId: number, clientId: string) {
    await testDb.db.insert(schema.oauthRefreshTokens).values({
      token: `refresh-${clientId}-${userId}`,
      clientId,
      userId,
      scopes: ['openid', 'offline_access'],
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
  }

  async function countGrants(clientId: string) {
    const consents = await testDb.db.select({ id: schema.oauthConsents.id })
      .from(schema.oauthConsents)
      .where(eq(schema.oauthConsents.clientId, clientId))
    const tokens = await testDb.db
      .select({ id: schema.oauthRefreshTokens.id })
      .from(schema.oauthRefreshTokens)
      .where(eq(schema.oauthRefreshTokens.clientId, clientId))

    return { consents: consents.length, tokens: tokens.length }
  }

  it('revokes only this user\'s older matching connection', async () => {
    const userId = await seedUser(testDb.db)
    const otherUserId = await seedUser(testDb.db)

    await seedClient('old')
    await seedClient('different-app', { name: 'Cursor' })
    await seedClient('different-redirect', {
      redirectUris: ['https://other.test/cb'],
    })
    await seedClient('current', { createdAt: NEWER })
    await seedConsent(userId, 'old')
    await seedRefreshToken(userId, 'old')
    await seedConsent(userId, 'different-app')
    await seedConsent(userId, 'different-redirect')
    await seedConsent(otherUserId, 'old')
    await seedConsent(userId, 'current')

    const revoked = await revokeSupersededClients(
      testDb.db,
      userId,
      'current',
    )

    expect(revoked).toEqual([
      { clientId: 'old', scopes: ['openid', 'chats:read', 'offline_access'] },
    ])
    expect(await countGrants('old')).toMatchObject({
      consents: 1,
      tokens: 0,
    })

    const remaining = await testDb.db.select({
      userId: schema.oauthConsents.userId,
      clientId: schema.oauthConsents.clientId,
    }).from(schema.oauthConsents)

    expect(remaining).toEqual(expect.arrayContaining([
      { userId: otherUserId, clientId: 'old' },
      { userId, clientId: 'different-app' },
      { userId, clientId: 'different-redirect' },
      { userId, clientId: 'current' },
    ]))
    expect(remaining).not.toContainEqual({ userId, clientId: 'old' })
  })

  it('finds an older connection that only holds a refresh token', async () => {
    const userId = await seedUser(testDb.db)

    await seedClient('old')
    await seedClient('current', { createdAt: NEWER })
    await seedRefreshToken(userId, 'old')

    const revoked = await revokeSupersededClients(
      testDb.db,
      userId,
      'current',
    )

    expect(revoked.map((client) => {
      return client.clientId
    })).toEqual(['old'])
  })

  it('never revokes a newer connection after a scope step-up', async () => {
    const userId = await seedUser(testDb.db)

    await seedClient('older-current')
    await seedClient('newer', { createdAt: NEWER })
    await seedConsent(userId, 'older-current')
    await seedConsent(userId, 'newer')

    const revoked = await revokeSupersededClients(
      testDb.db,
      userId,
      'older-current',
    )

    expect(revoked).toEqual([])
    expect((await countGrants('newer')).consents).toBe(1)
  })

  it('returns nothing when the current client is missing', async () => {
    const userId = await seedUser(testDb.db)

    expect(await revokeSupersededClients(testDb.db, userId, 'missing'))
      .toEqual([])
  })

  it('returns nothing when the user has no other grants', async () => {
    const userId = await seedUser(testDb.db)

    await seedClient('current', { createdAt: NEWER })
    await seedConsent(userId, 'current')

    expect(await revokeSupersededClients(testDb.db, userId, 'current'))
      .toEqual([])
  })
})
