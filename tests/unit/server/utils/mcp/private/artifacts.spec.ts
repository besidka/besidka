import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../../../../setup/helpers/artifacts-store'

const mocks = vi.hoisted(() => {
  return {
    enabledFlags: new Set<string>(),
    optedOutFlags: new Set<string>(),
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useEncryptText: async (plain: string) => `enc:${plain}`,
  useDecryptText: async (encrypted: string) => encrypted.slice(4),
}))

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => ({}),
    loadFeatureRules: async () => ({}),
    loadUserFeatureState: async () => null,
    evaluateFeature: async (flag: string) => {
      return { value: mocks.enabledFlags.has(flag) }
    },
    isFeatureActive: (flag: string, resolution: { value: boolean }) => {
      return resolution.value && !mocks.optedOutFlags.has(flag)
    },
  }
})

const { createArtifact } = await import('~~/server/utils/artifacts/store')
const { decodeArtifactId } = await import('~~/server/utils/artifacts/store')
const {
  createMcpArtifact,
  deleteMcpArtifacts,
  getMcpArtifact,
  listMcpArtifactShares,
  listMcpArtifacts,
  revokeMcpArtifactShares,
  shareMcpArtifact,
  updateMcpArtifact,
  MCP_ARTIFACT_CONTENT_MAX_CHARS,
  MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
} = await import('~~/server/utils/mcp/private/artifacts')

const SITE_URL = 'https://besidka.test'
const CLIENT_ID = 'client-1'
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const ALL_FLAGS = [
  'artifacts',
  'artifacts.mcp',
  'artifacts.share',
  'artifacts.react',
]

function createFakeKv() {
  const entries = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key)
    }),
  }
}

describe('MCP artifact logic', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let kv: ReturnType<typeof createFakeKv>
  let ownerId: number
  let strangerId: number
  let logger: { set: ReturnType<typeof vi.fn> }

  function context(userId: number = ownerId) {
    return {
      db: testDb.db,
      storage,
      kv: kv as never,
      userId,
      clientId: CLIENT_ID,
      logger,
      siteUrl: SITE_URL,
    }
  }

  async function createOwned(
    overrides: Partial<{
      userId: number
      kind: 'html' | 'react' | 'markdown'
      title: string
      content: string
    }> = {},
  ) {
    return await createArtifact({
      db: testDb.db,
      storage,
      userId: ownerId,
      kind: 'html',
      title: 'Quiz',
      content: '<p>hello world</p>',
      createdVia: 'chat',
      createdBy: 'model',
      ...overrides,
    })
  }

  function countRows(table: string): number {
    const row = testDb.sqlite.prepare(`select count(*) as count from ${table}`)
      .get() as { count: number }

    return row.count
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    kv = createFakeKv()
    logger = { set: vi.fn() }
    mocks.enabledFlags = new Set(ALL_FLAGS)
    mocks.optedOutFlags = new Set()
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('feature flags', () => {
    it('refuses every tool with one generic error when artifacts.mcp is off',
      async () => {
        const artifact = await createOwned()

        mocks.enabledFlags.delete('artifacts.mcp')

        const calls = [
          () => listMcpArtifacts(context(), {}),
          () => getMcpArtifact(context(), { id: artifact.artifactId }),
          () => listMcpArtifactShares(
            context(),
            { id: artifact.artifactId },
            { includeUrls: true },
          ),
          () => createMcpArtifact(context(), {
            kind: 'html',
            title: 'New',
            content: '<p>x</p>',
          }),
          () => updateMcpArtifact(context(), {
            id: artifact.artifactId,
            content: '<p>y</p>',
          }),
          () => revokeMcpArtifactShares(context(), {
            artifactIds: [artifact.artifactId],
          }),
          () => shareMcpArtifact(context(), {
            id: artifact.artifactId,
            expiresInDays: 7,
          }),
          () => deleteMcpArtifacts(context(), {
            ids: [artifact.artifactId],
            confirm: true,
          }),
        ]

        for (const call of calls) {
          await expect(call()).rejects.toMatchObject({
            status: 404,
            message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
          })
        }

        expect(countRows('artifacts')).toBe(1)
        expect(storage.objects.size).toBe(1)
      })

    it('refuses when the parent artifacts flag is off', async () => {
      mocks.enabledFlags.delete('artifacts')

      await expect(listMcpArtifacts(context(), {})).rejects.toMatchObject({
        status: 404,
        message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
      })
    })

    it('answers an unknown id and a flag-off call the same way for others',
      async () => {
        const foreign = await createOwned()

        mocks.enabledFlags.delete('artifacts.mcp')

        const flagOff = await getMcpArtifact(context(strangerId), {
          id: foreign.artifactId,
        }).catch((exception) => {
          return exception
        })
        const unknownId = await getMcpArtifact(context(strangerId), {
          id: 'pub-9999',
        }).catch((exception) => {
          return exception
        })

        expect(flagOff.message).toBe(MCP_ARTIFACT_UNAVAILABLE_MESSAGE)
        expect(unknownId.message).toBe(MCP_ARTIFACT_UNAVAILABLE_MESSAGE)
      })

    it('needs artifacts.share for share_artifact only', async () => {
      const artifact = await createOwned()

      mocks.enabledFlags.delete('artifacts.share')

      await expect(shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
      })).rejects.toMatchObject({
        message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
      })
      await expect(listMcpArtifactShares(context(), {
        id: artifact.artifactId,
      }, { includeUrls: true })).resolves.toEqual([])
      expect(countRows('artifact_shares')).toBe(0)
    })

    it('needs artifacts.react to create or update a react artifact',
      async () => {
        const react = await createOwned({
          kind: 'react',
          content: 'export default function A() { return null }',
        })

        mocks.enabledFlags.delete('artifacts.react')

        await expect(createMcpArtifact(context(), {
          kind: 'react',
          title: 'React',
          content: 'export default () => null',
        })).rejects.toMatchObject({
          message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
        })
        await expect(updateMcpArtifact(context(), {
          id: react.artifactId,
          content: 'export default () => 1',
        })).rejects.toMatchObject({
          message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
        })
        await expect(createMcpArtifact(context(), {
          kind: 'markdown',
          title: 'Notes',
          content: '# Notes',
        })).resolves.toMatchObject({ version: 1 })
      })

    it('keeps revoke and delete open for a user who switched artifacts off',
      async () => {
        const artifact = await createOwned()

        mocks.optedOutFlags.add('artifacts')

        await expect(createMcpArtifact(context(), {
          kind: 'html',
          title: 'New',
          content: '<p>x</p>',
        })).rejects.toMatchObject({
          message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
        })
        await expect(listMcpArtifacts(context(), {})).rejects.toMatchObject({
          message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
        })
        await expect(revokeMcpArtifactShares(context(), {
          artifactIds: [artifact.artifactId],
        })).resolves.toEqual({ revoked: 0, notFound: [] })
        await expect(deleteMcpArtifacts(context(), {
          ids: [artifact.artifactId],
          confirm: true,
        })).resolves.toMatchObject({ deleted: [artifact.artifactId] })
      })
  })

  describe('create_artifact', () => {
    it('stores an mcp artifact with an in-app link', async () => {
      const result = await createMcpArtifact(context(), {
        kind: 'html',
        title: '  Plan   board ',
        content: '<h1>Plan</h1>',
      })

      expect(result).toEqual({
        id: expect.any(String),
        version: 1,
        url_in_app: `${SITE_URL}/chats/artifacts?artifact=${result.id}`,
      })

      const [artifact] = await testDb.db.select().from(schema.artifacts)
      const [version] = await testDb.db.select().from(schema.artifactVersions)

      expect(artifact).toMatchObject({
        userId: ownerId,
        kind: 'html',
        title: 'Plan board',
        createdVia: 'mcp',
        originChatId: null,
        currentVersion: 1,
      })
      expect(version).toMatchObject({ createdBy: 'mcp', version: 1 })
    })

    it('refuses content above 200,000 characters', async () => {
      await expect(createMcpArtifact(context(), {
        kind: 'markdown',
        title: 'Big',
        content: 'x'.repeat(MCP_ARTIFACT_CONTENT_MAX_CHARS + 1),
      })).rejects.toMatchObject({ status: 400 })
      expect(countRows('artifacts')).toBe(0)
    })

    it('still applies the byte limit of the store', async () => {
      await expect(createMcpArtifact(context(), {
        kind: 'markdown',
        title: 'Wide',
        content: '€'.repeat(MCP_ARTIFACT_CONTENT_MAX_CHARS),
      })).rejects.toMatchObject({ status: 413 })
      expect(countRows('artifacts')).toBe(0)
    })

    it('puts the reason and the fix into the message', async () => {
      const exception = await createMcpArtifact(context(), {
        kind: 'markdown',
        title: 'Wide',
        content: '€'.repeat(MCP_ARTIFACT_CONTENT_MAX_CHARS),
      }).catch((error) => {
        return error
      })

      expect(exception.message).toContain('too large')
      expect(exception.message).toContain('bytes')
      expect(exception.message).toContain('smaller')
    })

    it('says storage is full in plain text and writes nothing', async () => {
      testDb.sqlite.prepare(`
        insert into files (user_id, storage_key, name, size, type, source,
          created_at, updated_at)
        values (?, 'key-1', 'file', ?, 'application/pdf', 'upload', 1, 1)
      `).run(ownerId, 20 * 1024 * 1024)

      const exception = await createMcpArtifact(context(), {
        kind: 'markdown',
        title: 'Notes',
        content: 'hello',
      }).catch((error) => {
        return error
      })

      expect(exception.status).toBe(413)
      expect(exception.message).toBe(
        'Storage is full. 20.0 MB of 20.0 MB used. Free space on the '
        + 'Storage page.',
      )
      expect(countRows('artifacts')).toBe(0)
    })

    it('rejects an unknown kind', async () => {
      await expect(createMcpArtifact(context(), {
        kind: 'pdf' as never,
        title: 'x',
        content: 'x',
      })).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('list_artifacts', () => {
    it('pages with an opaque cursor, newest first', async () => {
      const first = await createOwned({ title: 'First' })
      const second = await createOwned({ title: 'Second' })
      const third = await createOwned({ title: 'Third' })

      testDb.sqlite.prepare('update artifacts set updated_at = ? where id = ?')
        .run(100, decodeArtifactId(first.artifactId))
      testDb.sqlite.prepare('update artifacts set updated_at = ? where id = ?')
        .run(200, decodeArtifactId(second.artifactId))
      testDb.sqlite.prepare('update artifacts set updated_at = ? where id = ?')
        .run(300, decodeArtifactId(third.artifactId))

      const page = await listMcpArtifacts(context(), { limit: 2 })

      expect(page.items.map(item => item.title)).toEqual(['Third', 'Second'])
      expect(page.nextCursor).toEqual(expect.any(String))
      expect(page.nextCursor).not.toContain('2')

      const next = await listMcpArtifacts(context(), {
        limit: 2,
        cursor: page.nextCursor!,
      })

      expect(next.items.map(item => item.title)).toEqual(['First'])
      expect(next.nextCursor).toBeNull()
    })

    it('shows only the caller\'s artifacts and maps the fields', async () => {
      const chat = await seedChat(testDb.db, ownerId)
      const owned = await createArtifact({
        db: testDb.db,
        storage,
        userId: ownerId,
        kind: 'svg',
        title: 'Logo',
        content: '<svg/>',
        originChatId: chat.id,
        createdVia: 'chat',
        createdBy: 'model',
      })

      await createOwned({ title: 'Mine, no chat' })
      await createArtifact({
        db: testDb.db,
        storage,
        userId: strangerId,
        kind: 'html',
        title: 'Foreign',
        content: '<p>x</p>',
        createdVia: 'chat',
        createdBy: 'model',
      })

      const result = await listMcpArtifacts(context(), { kind: 'svg' })

      expect(result.items).toEqual([{
        id: owned.artifactId,
        title: 'Logo',
        kind: 'svg',
        version: 1,
        updatedAt: expect.any(String),
        originChatSlug: chat.slug,
        activeShares: 0,
        takenDown: false,
      }])

      const all = await listMcpArtifacts(context(), { query: 'Mine' })

      expect(all.items).toHaveLength(1)
      expect(all.items[0]!.originChatSlug).toBeNull()
    })

    it('rejects a cursor it did not issue', async () => {
      await expect(listMcpArtifacts(context(), { cursor: '%%%' }))
        .rejects.toMatchObject({ status: 400 })
      await expect(listMcpArtifacts(context(), {
        cursor: btoa('rows:5'),
      })).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('get_artifact', () => {
    it('returns the latest content and the version numbers', async () => {
      const artifact = await createOwned()

      await updateMcpArtifact(context(), {
        id: artifact.artifactId,
        content: '<p>second</p>',
      })

      await expect(getMcpArtifact(context(), { id: artifact.artifactId }))
        .resolves.toEqual({
          id: artifact.artifactId,
          title: 'Quiz',
          kind: 'html',
          version: 2,
          versions: [1, 2],
          content: '<p>second</p>',
        })
      await expect(getMcpArtifact(context(), {
        id: artifact.artifactId,
        version: 1,
      })).resolves.toMatchObject({ version: 1, content: '<p>hello world</p>' })
    })

    it('answers 404 for a foreign id, an unknown id and a missing version',
      async () => {
        const artifact = await createOwned()

        await expect(getMcpArtifact(context(strangerId), {
          id: artifact.artifactId,
        })).rejects.toMatchObject({ status: 404 })
        await expect(getMcpArtifact(context(), { id: 'pub-9999' }))
          .rejects.toMatchObject({ status: 404 })
        await expect(getMcpArtifact(context(), {
          id: artifact.artifactId,
          version: 9,
        })).rejects.toMatchObject({ status: 404 })
      })

    it('refuses a taken-down artifact', async () => {
      const artifact = await createOwned()

      testDb.sqlite.prepare('update artifacts set takedown_at = 1 where id = ?')
        .run(decodeArtifactId(artifact.artifactId))

      await expect(getMcpArtifact(context(), { id: artifact.artifactId }))
        .rejects.toMatchObject({ status: 451 })
    })
  })

  describe('update_artifact', () => {
    it('applies edits to the latest version as an mcp version', async () => {
      const artifact = await createOwned({
        content: '<p>alpha</p><p>beta</p>',
      })
      const result = await updateMcpArtifact(context(), {
        id: artifact.artifactId,
        title: 'Renamed',
        edits: [
          { old_string: 'alpha', new_string: 'one' },
          { old_string: 'beta', new_string: 'two' },
        ],
      })

      expect(result).toEqual({ id: artifact.artifactId, version: 2 })

      await expect(getMcpArtifact(context(), { id: artifact.artifactId }))
        .resolves.toMatchObject({
          title: 'Renamed',
          content: '<p>one</p><p>two</p>',
        })

      const versions = await testDb.db.select().from(schema.artifactVersions)

      expect(versions.map(version => version.createdBy))
        .toEqual(['model', 'mcp'])
    })

    it('names the failing edit and writes nothing, like the chat tool',
      async () => {
        const artifact = await createOwned({ content: '<p>a</p><p>a</p>' })

        const missing = await updateMcpArtifact(context(), {
          id: artifact.artifactId,
          edits: [{ old_string: 'zzz', new_string: 'x' }],
        }).catch((error) => {
          return error
        })
        const ambiguous = await updateMcpArtifact(context(), {
          id: artifact.artifactId,
          edits: [{ old_string: '<p>a</p>', new_string: 'x' }],
        }).catch((error) => {
          return error
        })
        const second = await updateMcpArtifact(context(), {
          id: artifact.artifactId,
          edits: [
            { old_string: '<p>a</p><p>', new_string: '<p>' },
            { old_string: 'nope', new_string: 'x' },
          ],
        }).catch((error) => {
          return error
        })

        expect(missing).toMatchObject({ status: 400 })
        expect(missing.message).toBe(
          'Edit 1 failed: old_string does not occur in the artifact. No '
          + 'change was saved. Copy old_string exactly from the current '
          + 'content and include enough surrounding text to make it unique.',
        )
        expect(ambiguous.message).toContain(
          'Edit 1 failed: old_string occurs more than once in the artifact.',
        )
        expect(second.message).toContain('Edit 2 failed')
        expect(countRows('artifact_versions')).toBe(1)
      })

    it('takes exactly one of edits and content', async () => {
      const artifact = await createOwned()

      await expect(updateMcpArtifact(context(), {
        id: artifact.artifactId,
      })).rejects.toMatchObject({
        status: 400,
        message: 'Send exactly one of `edits` or `content`.',
      })
      await expect(updateMcpArtifact(context(), {
        id: artifact.artifactId,
        content: 'x',
        edits: [{ old_string: 'hello', new_string: 'bye' }],
      })).rejects.toMatchObject({ status: 400 })
      expect(countRows('artifact_versions')).toBe(1)
    })

    it('does not touch a foreign or unknown artifact', async () => {
      const artifact = await createOwned()

      await expect(updateMcpArtifact(context(strangerId), {
        id: artifact.artifactId,
        content: '<p>mine now</p>',
      })).rejects.toMatchObject({ status: 404 })
      await expect(updateMcpArtifact(context(), {
        id: 'pub-9999',
        content: 'x',
      })).rejects.toMatchObject({ status: 404 })
      expect(countRows('artifact_versions')).toBe(1)
    })

    it('refuses a new version when storage is full and keeps the old one', async () => {
      const artifact = await createOwned()

      testDb.sqlite.prepare(`
        insert into files (user_id, storage_key, name, size, type, source,
          created_at, updated_at)
        values (?, 'key-1', 'file', ?, 'application/pdf', 'upload', 1, 1)
      `).run(ownerId, 20 * 1024 * 1024)

      await expect(updateMcpArtifact(context(), {
        id: artifact.artifactId,
        content: 'new text',
      })).rejects.toMatchObject({
        status: 413,
        message: expect.stringContaining('Storage is full'),
      })
      expect(countRows('artifact_versions')).toBe(1)
    })

    it('refuses to grow an artifact past 200,000 characters', async () => {
      const artifact = await createOwned()

      await expect(updateMcpArtifact(context(), {
        id: artifact.artifactId,
        content: 'x'.repeat(MCP_ARTIFACT_CONTENT_MAX_CHARS + 1),
      })).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('share_artifact', () => {
    it('creates a link with storage and bridge forced off', async () => {
      const artifact = await createOwned()
      const before = Date.now()
      const result = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
      })

      expect(result.url).toMatch(
        new RegExp(`^${SITE_URL}/artifacts/[\\w-]{43}$`),
      )
      expect(result.warnings).toEqual([])

      const [share] = await testDb.db.select().from(schema.artifactShares)

      expect(share).toMatchObject({
        createdVia: 'mcp',
        clientId: CLIENT_ID,
        storageAllowed: false,
        bridgeAllowed: false,
        pinnedVersion: null,
        userId: ownerId,
      })

      const expiresAt = share!.expiresAt!.getTime()

      expect(expiresAt)
        .toBeGreaterThanOrEqual(before + 7 * DAY_MILLISECONDS - 2000)
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MILLISECONDS)
      expect(result.shareId).toMatch(/^sh_/)
      expect(new Date(result.expiresAt!).getTime()).toBe(expiresAt)
    })

    it('pins a version and warns about personal data', async () => {
      const artifact = await createOwned({
        content: '<p>Contact jane.doe@acme-corp.io</p>',
      })

      await updateMcpArtifact(context(), {
        id: artifact.artifactId,
        content: '<p>clean</p>',
      })

      const pinned = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 30,
        pinnedVersion: 1,
      })
      const latest = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 30,
      })

      expect(pinned.warnings).toEqual(['email'])
      expect(latest.warnings).toEqual([])

      const shares = await testDb.db.select().from(schema.artifactShares)

      expect(shares.map(share => share.pinnedVersion)).toEqual([1, null])
    })

    it('rejects expiries outside 1 to 30 days and writes nothing', async () => {
      const artifact = await createOwned()

      for (const expiresInDays of [0, 31, 1.5, -1]) {
        await expect(shareMcpArtifact(context(), {
          id: artifact.artifactId,
          expiresInDays,
        })).rejects.toMatchObject({ status: 400 })
      }

      expect(countRows('artifact_shares')).toBe(0)
    })

    it('answers 404 for foreign ids', async () => {
      const artifact = await createOwned()

      await expect(shareMcpArtifact(context(strangerId), {
        id: artifact.artifactId,
        expiresInDays: 7,
      })).rejects.toMatchObject({ status: 404 })
      expect(countRows('artifact_shares')).toBe(0)
    })

    it('answers 400 for a pinned version that does not exist', async () => {
      const artifact = await createOwned()
      const exception = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
        pinnedVersion: 5,
      }).catch((error) => {
        return error
      })

      expect(exception).toMatchObject({ status: 400 })
      expect(exception.message).toContain('Version 5 does not exist')
      expect(countRows('artifact_shares')).toBe(0)
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('does not spend the allowance when the artifact is full', async () => {
      const artifact = await createOwned()

      for (let index = 0; index < 10; index += 1) {
        await shareMcpArtifact(context(), {
          id: artifact.artifactId,
          expiresInDays: 7,
        })
      }

      kv.put.mockClear()

      await expect(shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
      })).rejects.toMatchObject({ status: 409 })
      expect(kv.put).not.toHaveBeenCalled()
      expect(countRows('artifact_shares')).toBe(10)
    })

    it('answers a retry-after of one second when the counter write fails', async () => {
      const artifact = await createOwned()

      kv.put.mockRejectedValueOnce(new Error('KV PUT failed: 429'))

      const exception = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
      }).catch((error) => {
        return error
      })

      expect(exception).toMatchObject({
        status: 429,
        data: { retryAfter: 1 },
      })
      expect(exception.message).toContain('1 second')
      expect(countRows('artifact_shares')).toBe(0)
    })

    it('refuses a taken-down artifact', async () => {
      const artifact = await createOwned()

      testDb.sqlite.prepare('update artifacts set takedown_at = 1 where id = ?')
        .run(decodeArtifactId(artifact.artifactId))

      await expect(shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 7,
      })).rejects.toMatchObject({ status: 451 })
    })

    it('caps connected-app link creation at 10 a day per user', async () => {
      const artifacts = []

      for (let index = 0; index < 11; index += 1) {
        artifacts.push(await createOwned({ title: `A${index}` }))
      }

      for (const artifact of artifacts.slice(0, 10)) {
        await shareMcpArtifact(context(), {
          id: artifact.artifactId,
          expiresInDays: 7,
        })
      }

      const exception = await shareMcpArtifact(context(), {
        id: artifacts[10]!.artifactId,
        expiresInDays: 7,
      }).catch((error) => {
        return error
      })

      expect(exception).toMatchObject({ status: 429 })
      expect(exception.message).toContain('10 public artifact links a day')
      expect(countRows('artifact_shares')).toBe(10)

      const strangerArtifact = await createArtifact({
        db: testDb.db,
        storage,
        userId: strangerId,
        kind: 'html',
        title: 'Other',
        content: '<p>x</p>',
        createdVia: 'chat',
        createdBy: 'model',
      })

      await expect(shareMcpArtifact(context(strangerId), {
        id: strangerArtifact.artifactId,
        expiresInDays: 7,
      })).resolves.toMatchObject({ shareId: expect.any(String) })
    })

    it('does not spend the daily allowance on a failed call', async () => {
      await expect(shareMcpArtifact(context(), {
        id: 'pub-9999',
        expiresInDays: 7,
      })).rejects.toMatchObject({ status: 404 })
      expect(kv.put).not.toHaveBeenCalled()
    })
  })

  describe('list_artifact_shares and revoke_artifact_shares', () => {
    it('lists the active links with the app that created them', async () => {
      const artifact = await createOwned()

      await testDb.db.insert(schema.oauthClients).values({
        clientId: CLIENT_ID,
        name: 'Claude',
        redirectUris: ['https://claude.ai/callback'],
      })

      const shared = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 3,
      })
      const shares = await listMcpArtifactShares(context(), {
        id: artifact.artifactId,
      }, { includeUrls: true })

      expect(shares).toEqual([{
        shareId: shared.shareId,
        status: 'active',
        url: shared.url,
        createdVia: 'mcp',
        createdByApp: 'Claude',
        pinnedVersion: null,
        expiresAt: shared.expiresAt,
        storageAllowed: false,
        bridgeAllowed: false,
      }])
      await expect(listMcpArtifactShares(context(strangerId), {
        id: artifact.artifactId,
      }, { includeUrls: true })).rejects.toMatchObject({ status: 404 })
    })

    it('hides the link from a caller without the share scope', async () => {
      const artifact = await createOwned()
      const shared = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 3,
      })
      const shares = await listMcpArtifactShares(context(), {
        id: artifact.artifactId,
      }, { includeUrls: false })

      expect(shares).toHaveLength(1)
      expect(shares[0]).toMatchObject({
        shareId: shared.shareId,
        status: 'active',
        url: null,
      })
    })

    it('revokes by share id and reports foreign and unknown ids', async () => {
      const artifact = await createOwned()
      const shared = await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 3,
      })

      await expect(revokeMcpArtifactShares(context(strangerId), {
        shareIds: [shared.shareId],
      })).resolves.toEqual({ revoked: 0, notFound: [shared.shareId] })
      await expect(revokeMcpArtifactShares(context(), {
        shareIds: [shared.shareId, 'sh_missing'],
      })).resolves.toEqual({ revoked: 1, notFound: ['sh_missing'] })
      await expect(listMcpArtifactShares(context(), {
        id: artifact.artifactId,
      }, { includeUrls: true })).resolves.toEqual([])
    })

    it('revokes every link of the named artifacts', async () => {
      const artifact = await createOwned()

      await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 3,
      })
      await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 5,
      })

      await expect(revokeMcpArtifactShares(context(), {
        artifactIds: [artifact.artifactId, 'pub-9999'],
      })).resolves.toEqual({ revoked: 2, notFound: ['pub-9999'] })
      expect(countRows('artifact_shares')).toBe(2)
    })

    it('needs exactly one of shareIds and artifactIds', async () => {
      await expect(revokeMcpArtifactShares(context(), {}))
        .rejects.toMatchObject({ status: 400 })
      await expect(revokeMcpArtifactShares(context(), {
        shareIds: ['sh_pub-1'],
        artifactIds: ['pub-1'],
      })).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('delete_artifacts', () => {
    it('needs confirm and deletes nothing without it', async () => {
      const artifact = await createOwned()

      await expect(deleteMcpArtifacts(context(), {
        ids: [artifact.artifactId],
        confirm: false,
      })).rejects.toMatchObject({ status: 400 })
      expect(countRows('artifacts')).toBe(1)
    })

    it('deletes owned artifacts and reports held and unknown ids',
      async () => {
        const first = await createOwned({ title: 'First' })
        const held = await createOwned({ title: 'Held' })
        const foreign = await createArtifact({
          db: testDb.db,
          storage,
          userId: strangerId,
          kind: 'html',
          title: 'Foreign',
          content: '<p>x</p>',
          createdVia: 'chat',
          createdBy: 'model',
        })

        testDb.sqlite.prepare(
          'update artifacts set legal_hold_until = ? where id = ?',
        ).run(
          Math.floor(Date.now() / 1000) + 3600,
          decodeArtifactId(held.artifactId),
        )

        const result = await deleteMcpArtifacts(context(), {
          ids: [
            first.artifactId,
            held.artifactId,
            foreign.artifactId,
            'garbage',
            first.artifactId,
          ],
          confirm: true,
        })

        expect(result).toEqual({
          deleted: [first.artifactId],
          held: [held.artifactId],
          notFound: [foreign.artifactId, 'garbage'],
        })

        const titles = (await testDb.db.select().from(schema.artifacts))
          .map(row => row.title)

        expect(titles.sort()).toEqual(['Foreign', 'Held'])
      })

    it('removes links and viewer storage but keeps report rows', async () => {
      const artifact = await createOwned()
      const internalId = decodeArtifactId(artifact.artifactId)

      await shareMcpArtifact(context(), {
        id: artifact.artifactId,
        expiresInDays: 3,
      })
      testDb.sqlite.prepare(`
        insert into artifact_reports
          (artifact_id, reason, status, created_at)
        values (?, 'harmful', 'open', 1)
      `).run(internalId)
      testDb.sqlite.prepare(`
        insert into artifact_storage
          (artifact_id, viewer_user_id, key, value, bytes, updated_at)
        values (?, ?, 'score', '1', 1, 1)
      `).run(internalId, strangerId)

      await deleteMcpArtifacts(context(), {
        ids: [artifact.artifactId],
        confirm: true,
      })

      expect(countRows('artifacts')).toBe(0)
      expect(countRows('artifact_versions')).toBe(0)
      expect(countRows('artifact_shares')).toBe(0)
      expect(countRows('artifact_storage')).toBe(0)
      expect(countRows('artifact_reports')).toBe(1)
      expect(storage.objects.size).toBe(0)
    })
  })
})
