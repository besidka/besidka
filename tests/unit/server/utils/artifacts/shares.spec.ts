import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_SHARE_MAX_ACTIVE } from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useEncryptText: async (plain: string) => `enc:${plain}`,
  useDecryptText: async (encrypted: string) => encrypted.slice(4),
}))

const { appendArtifactVersion, createArtifact } = await import(
  '~~/server/utils/artifacts/store'
)
const {
  buildActiveArtifactShareFilter,
  createArtifactShare,
  decodeArtifactShareId,
  encodeArtifactShareId,
  extractArtifactShareToken,
  generateArtifactShareToken,
  hashArtifactShareToken,
  listArtifactShares,
  resolveActiveArtifactShare,
  revokeArtifactShares,
} = await import('~~/server/utils/artifacts/shares')

const BASE_URL = 'https://besidka.test'
const NOW = new Date('2026-11-09T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

describe('artifact shares', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let ownerId: number
  let strangerId: number
  let artifactId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)

    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId: ownerId,
      kind: 'html',
      title: 'Quiz',
      content: '<p>v1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
  })

  afterEach(() => {
    testDb.close()
  })

  function share(overrides: Partial<{
    userId: number
    artifactId: string
    expiresAt: Date | null
    pinnedVersion: number | null
    now: Date
  }> = {}) {
    return createArtifactShare({
      db: testDb.db,
      userId: ownerId,
      artifactId,
      expiresAt: null,
      pinnedVersion: null,
      storageAllowed: false,
      bridgeAllowed: false,
      createdVia: 'ui',
      baseUrl: BASE_URL,
      now: NOW,
      ...overrides,
    })
  }

  describe('tokens and ids', () => {
    it('generates 32-byte base64url tokens', () => {
      const tokens = new Set(Array.from({ length: 20 }, () => {
        return generateArtifactShareToken()
      }))

      expect(tokens.size).toBe(20)

      for (const token of tokens) {
        expect(token).toMatch(/^[\w-]{43}$/)
        expect(Buffer.from(token, 'base64url')).toHaveLength(32)
      }
    })

    it('hashes a token as sha256 hex', async () => {
      const token = generateArtifactShareToken()

      await expect(hashArtifactShareToken(token)).resolves.toBe(
        createHash('sha256').update(token).digest('hex'),
      )
    })

    it('stores only the hash and the encrypted token', async () => {
      const created = await share()
      const [row] = await testDb.db.select().from(schema.artifactShares)

      expect(row?.tokenHash).toBe(await hashArtifactShareToken(created.token))
      expect(row?.tokenEncrypted).toBe(`enc:${created.token}`)
      expect(JSON.stringify(row)).not.toContain(`"${created.token}"`)
      expect(created.url).toBe(`${BASE_URL}/a/${created.token}`)
    })

    it('round-trips share ids and never confuses them with artifact ids',
      () => {
        expect(encodeArtifactShareId(7)).toBe('sh_pub-7')
        expect(decodeArtifactShareId('sh_pub-7')).toBe(7)
        expect(decodeArtifactShareId('pub-7')).toBeNull()
        expect(decodeArtifactShareId('sh_')).toBeNull()
      })

    it('extracts a token from a full link or a bare token', () => {
      const token = generateArtifactShareToken()

      expect(extractArtifactShareToken(token)).toBe(token)
      expect(extractArtifactShareToken(`https://besidka.com/a/${token}`))
        .toBe(token)
      expect(extractArtifactShareToken(`/a/${token}/`)).toBe(token)
      expect(extractArtifactShareToken('https://besidka.com/a/short'))
        .toBeNull()
      expect(extractArtifactShareToken('pub-1')).toBeNull()
    })
  })

  describe('create', () => {
    it('refuses a pinned version that does not exist', async () => {
      await expect(share({ pinnedVersion: 2 }))
        .rejects.toMatchObject({ status: 400 })
      await expect(share({ pinnedVersion: 1 })).resolves.toBeTruthy()
    })

    it('refuses a foreign or taken-down artifact', async () => {
      await expect(share({ userId: strangerId }))
        .rejects.toMatchObject({ status: 404 })

      testDb.sqlite.prepare('update artifacts set takedown_at = 1').run()

      await expect(share()).rejects.toMatchObject({ status: 451 })
    })

    it('caps active links at ten per artifact', async () => {
      for (let index = 0; index < ARTIFACT_SHARE_MAX_ACTIVE; index++) {
        await share()
      }

      await expect(share()).rejects.toMatchObject({
        status: 409,
        code: 'artifact_share_limit',
      })

      const [first] = await testDb.db.select().from(schema.artifactShares)

      await revokeArtifactShares({
        db: testDb.db,
        userId: ownerId,
        shareIds: [encodeArtifactShareId(first!.id)],
        now: NOW,
      })

      await expect(share()).resolves.toBeTruthy()
    })

    it('does not count expired links against the cap', async () => {
      for (let index = 0; index < ARTIFACT_SHARE_MAX_ACTIVE; index++) {
        await share({ expiresAt: new Date(NOW.getTime() - HOUR) })
      }

      await expect(share()).resolves.toBeTruthy()
    })
  })

  describe('active filter', () => {
    it('matches only live links', async () => {
      await share()
      await share({ expiresAt: new Date(NOW.getTime() + HOUR) })
      await share({ expiresAt: new Date(NOW.getTime() - HOUR) })

      const revoked = await share()
      const takenDown = await share()

      testDb.sqlite.prepare(
        'update artifact_shares set revoked_at = 1 where id = ?',
      ).run(decodeArtifactShareId(revoked.share.shareId))
      testDb.sqlite.prepare(
        'update artifact_shares set takedown_at = 1 where id = ?',
      ).run(decodeArtifactShareId(takenDown.share.shareId))

      const rows = await testDb.db
        .select({ id: schema.artifactShares.id })
        .from(schema.artifactShares)
        .where(buildActiveArtifactShareFilter(NOW))

      expect(rows).toHaveLength(2)
    })
  })

  describe('resolve', () => {
    it('shows the latest version unless the link is pinned', async () => {
      const latest = await share()
      const pinned = await share({ pinnedVersion: 1 })

      await appendArtifactVersion({
        db: testDb.db,
        storage,
        userId: ownerId,
        artifactId,
        content: '<p>v2</p>',
        createdBy: 'model',
      })

      await expect(resolveActiveArtifactShare({
        db: testDb.db,
        token: latest.token,
        now: NOW,
      })).resolves.toMatchObject({ status: 'active', version: 2 })
      await expect(resolveActiveArtifactShare({
        db: testDb.db,
        token: pinned.token,
        now: NOW,
      })).resolves.toMatchObject({ status: 'active', version: 1 })
    })

    it('returns null for unknown, revoked and expired links', async () => {
      const expiring = await share({
        expiresAt: new Date(NOW.getTime() + HOUR),
      })
      const revoked = await share()

      await revokeArtifactShares({
        db: testDb.db,
        userId: ownerId,
        shareIds: [revoked.share.shareId],
        now: NOW,
      })

      for (const token of [
        generateArtifactShareToken(),
        'not-a-token',
        null,
        revoked.token,
      ]) {
        await expect(resolveActiveArtifactShare({
          db: testDb.db,
          token,
          now: NOW,
        })).resolves.toBeNull()
      }

      await expect(resolveActiveArtifactShare({
        db: testDb.db,
        token: expiring.token,
        now: new Date(NOW.getTime() + 2 * HOUR),
      })).resolves.toBeNull()
    })

    it('reports a takedown of the link or of the artifact', async () => {
      const created = await share()

      testDb.sqlite.prepare('update artifacts set takedown_at = 1').run()

      await expect(resolveActiveArtifactShare({
        db: testDb.db,
        token: created.token,
        now: NOW,
      })).resolves.toMatchObject({ status: 'taken-down' })
    })
  })

  describe('revoke', () => {
    it('revokes only links the user owns and reports the rest', async () => {
      const own = await share()
      const foreignArtifact = await createArtifact({
        db: testDb.db,
        storage,
        userId: strangerId,
        kind: 'html',
        title: 'Foreign',
        content: '<p>x</p>',
        createdVia: 'chat',
        createdBy: 'model',
      })
      const foreign = await share({
        userId: strangerId,
        artifactId: foreignArtifact.artifactId,
      })

      await expect(revokeArtifactShares({
        db: testDb.db,
        userId: ownerId,
        shareIds: [own.share.shareId, foreign.share.shareId, 'sh_bogus'],
        now: NOW,
      })).resolves.toEqual({
        revoked: 1,
        notFound: ['sh_bogus', foreign.share.shareId],
      })

      const rows = await testDb.db.select().from(schema.artifactShares)

      expect(rows).toHaveLength(2)
      expect(rows.find((row) => {
        return row.userId === strangerId
      })?.revokedAt).toBeNull()
    })

    it('revokes every link of an owned artifact and keeps the rows',
      async () => {
        await share()
        await share()

        await expect(revokeArtifactShares({
          db: testDb.db,
          userId: strangerId,
          artifactIds: [artifactId],
          now: NOW,
        })).resolves.toEqual({ revoked: 0, notFound: [artifactId] })
        await expect(revokeArtifactShares({
          db: testDb.db,
          userId: ownerId,
          artifactIds: [artifactId],
          now: NOW,
        })).resolves.toEqual({ revoked: 2, notFound: [] })
        await expect(revokeArtifactShares({
          db: testDb.db,
          userId: ownerId,
          artifactIds: [artifactId],
          now: NOW,
        })).resolves.toEqual({ revoked: 0, notFound: [] })

        expect(await testDb.db.select().from(schema.artifactShares))
          .toHaveLength(2)
      })
  })

  describe('list', () => {
    it('lists active links first with URLs and recent ended ones without',
      async () => {
        const old = await share({
          now: new Date(NOW.getTime() - 40 * 24 * HOUR),
        })
        const ended = await share({ now: new Date(NOW.getTime() - 2 * HOUR) })
        const active = await share({ now: new Date(NOW.getTime() - 3 * HOUR) })

        await revokeArtifactShares({
          db: testDb.db,
          userId: ownerId,
          shareIds: [old.share.shareId],
          now: new Date(NOW.getTime() - 35 * 24 * HOUR),
        })
        await revokeArtifactShares({
          db: testDb.db,
          userId: ownerId,
          shareIds: [ended.share.shareId],
          now: new Date(NOW.getTime() - HOUR),
        })

        const shares = await listArtifactShares({
          db: testDb.db,
          userId: ownerId,
          artifactId,
          includeEnded: true,
          now: NOW,
          baseUrl: BASE_URL,
        })

        expect(shares.map((summary) => {
          return [summary.shareId, summary.status, summary.url]
        })).toEqual([
          [active.share.shareId, 'active', active.url],
          [ended.share.shareId, 'revoked', null],
        ])
        await expect(listArtifactShares({
          db: testDb.db,
          userId: strangerId,
          artifactId,
          includeEnded: true,
          now: NOW,
        })).rejects.toMatchObject({ status: 404 })
      })

    it('names the OAuth client of an MCP link', async () => {
      await testDb.db.insert(schema.oauthClients).values({
        clientId: 'client-1',
        name: 'Claude',
        redirectUris: ['https://claude.ai/callback'],
      })
      await createArtifactShare({
        db: testDb.db,
        userId: ownerId,
        artifactId,
        expiresAt: null,
        pinnedVersion: null,
        storageAllowed: false,
        bridgeAllowed: false,
        createdVia: 'mcp',
        clientId: 'client-1',
        baseUrl: BASE_URL,
        now: NOW,
      })

      const [summary] = await listArtifactShares({
        db: testDb.db,
        userId: ownerId,
        artifactId,
        includeEnded: false,
        now: NOW,
        baseUrl: BASE_URL,
      })

      expect(summary).toMatchObject({ createdVia: 'mcp', clientName: 'Claude' })
    })
  })
})
