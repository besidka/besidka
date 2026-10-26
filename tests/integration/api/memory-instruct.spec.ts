import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { MEMORY_INSTRUCT_LIMITS } from '#shared/utils/memory-instruct'
import { MEMORY_RATE_LIMITS } from '~~/server/utils/memory/rate-limit'
import {
  createMemoryExtractionTestDb,
  seedEntry,
  seedProject,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveMemoryModel: vi.fn(),
  loggerSet: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()

  return { ...original, generateText: mocks.generateText }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/memory/resolve-model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/resolve-model')
  >()

  return { ...original, resolveMemoryModel: mocks.resolveMemoryModel }
})

const SECRET_TEXT = 'I moved to Kraków. Forget the coffee thing.'

function createKvStub() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function createSelection() {
  return {
    scope: 'profile',
    source: 'fallback',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
    instantiate: vi.fn(async () => {
      return {
        model: { id: 'mock-model' },
        reasoning: undefined,
        providerOptions: {},
      }
    }),
  }
}

function mockOps(ops: unknown[]) {
  mocks.generateText.mockResolvedValue({
    output: { ops },
    usage: { inputTokens: 10, outputTokens: 5 },
  })
}

function createEvent(body: unknown) {
  return { body, res: { headers: new Headers() } }
}

describe('memory instruct routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kv: ReturnType<typeof createKvStub>
  let originalResolve: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.resetModules()
    mocks.generateText.mockReset()
    mocks.loggerSet.mockReset()
    mocks.assertNotCrossSiteRequest.mockReset()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    kv = createKvStub()

    const resolveModule = await vi.importActual<
      typeof import('~~/server/utils/memory/resolve-model')
    >('~~/server/utils/memory/resolve-model')

    originalResolve = resolveModule.resolveMemoryModel as never
    mocks.resolveMemoryModel.mockReset()
    mocks.resolveMemoryModel.mockImplementation(originalResolve)

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function callPreview(body: unknown) {
    const module = await import(
      '../../../server/api/v1/memory/instruct/preview.post'
    )

    return await module.default(createEvent(body) as never)
  }

  async function callApply(body: unknown) {
    const module = await import(
      '../../../server/api/v1/memory/instruct/apply.post'
    )

    return await module.default(createEvent(body) as never)
  }

  async function readUpdatedAt(id: string): Promise<string> {
    const entry = await testDb.db.query.memoryEntries.findFirst({
      where: { id },
    })

    return entry!.updatedAt.toISOString()
  }

  function loggedText(): string {
    return JSON.stringify(mocks.loggerSet.mock.calls)
  }

  describe('POST /api/v1/memory/instruct/preview', () => {
    it('rejects unauthenticated and cross-site requests', async () => {
      mocks.assertNotCrossSiteRequest.mockImplementationOnce(() => {
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      })

      await expect(callPreview({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 403,
      })

      vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

      await expect(callPreview({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 401,
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('rejects empty and oversized text without echoing it', async () => {
      const oversized = 'x'.repeat(MEMORY_INSTRUCT_LIMITS.maxTextChars + 1)

      await expect(callPreview({ text: '  ' })).rejects.toMatchObject({
        status: 400,
      })

      const error = await callPreview({ text: oversized })
        .catch((exception) => {
          return exception
        })

      expect(error).toMatchObject({ status: 400 })
      expect(JSON.stringify(error)).not.toContain('xxxxxxxx')
    })

    it('answers 409 with a fix when no API key is saved', async () => {
      await expect(callPreview({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 409,
        message: 'No model available for memory',
        fix: expect.any(String),
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('answers 409 when memory is off', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryEnabled: false })
        .where(eq(schema.userSettings.userId, userId))

      await expect(callPreview({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 409,
        message: 'Memory is turned off',
      })
    })

    it('answers 404 for a project of another user', async () => {
      const otherUserId = await seedUser(testDb.db)
      const foreignProjectId = await seedProject(testDb.db, otherUserId)

      mocks.resolveMemoryModel.mockResolvedValue(createSelection())

      await expect(callPreview({
        text: SECRET_TEXT,
        projectId: foreignProjectId,
      })).rejects.toMatchObject({ status: 404 })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('previews project changes from the project scope only', async () => {
      const projectId = await seedProject(testDb.db, userId)

      await seedEntry(testDb.db, userId, {
        slug: 'account-coffee',
        title: 'Account coffee',
      })
      await seedEntry(testDb.db, userId, {
        projectId,
        slug: 'stack',
        title: 'Stack',
      })
      mocks.resolveMemoryModel.mockResolvedValue(createSelection())
      mockOps([{
        op: 'create',
        ref: null,
        category: 'topics',
        title: 'Deadline',
        description: 'Project deadline',
        body: '- Deadline is 15 Nov',
        reason: null,
        evidence: null,
      }])

      const response = await callPreview({
        text: 'For this project the deadline is 15 Nov',
        projectId,
      })
      const prompt = mocks.generateText.mock.calls[0]![0].messages[0].content

      expect(mocks.resolveMemoryModel).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'project', projectId, userId }),
      )
      expect(prompt).toContain('Stack')
      expect(prompt).not.toContain('Account coffee')
      expect(response).toMatchObject({
        projectId,
        operations: [expect.objectContaining({
          kind: 'create',
          status: 'ready',
        })],
        capacity: { total: 1, limit: 15 },
      })
      expect(await testDb.db.select().from(schema.memoryEntries))
        .toHaveLength(2)
    })

    it('logs counts and the model id but never the text', async () => {
      mocks.resolveMemoryModel.mockResolvedValue(createSelection())
      mockOps([])

      await callPreview({ text: SECRET_TEXT })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryInstruct: expect.objectContaining({
            status: 'ready',
            model: 'gpt-test',
            ops: { create: 0, update: 0, delete: 0, rejected: 0 },
          }),
        },
      })
      expect(loggedText()).not.toContain('Kraków')
      expect(loggedText()).not.toContain('coffee')
    })

    it('answers 429 after too many previews', async () => {
      mocks.resolveMemoryModel.mockResolvedValue(createSelection())
      mockOps([])

      const { max } = MEMORY_RATE_LIMITS['instruct-preview']

      for (let index = 0; index < max; index++) {
        await callPreview({ text: SECRET_TEXT })
      }

      await expect(callPreview({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 429,
      })
      expect(mocks.generateText).toHaveBeenCalledTimes(max)
    })
  })

  describe('POST /api/v1/memory/instruct/apply', () => {
    it('applies the ticked operations to the account', async () => {
      const coffeeId = await seedEntry(testDb.db, userId, {
        slug: 'coffee',
        title: 'Coffee',
      })

      const response = await callApply({
        operations: [
          {
            kind: 'create',
            category: 'topics',
            title: 'Travel',
            description: 'Trips the user plans',
            body: '- Lisbon in May',
          },
          {
            kind: 'delete',
            id: coffeeId,
            updatedAt: await readUpdatedAt(coffeeId),
          },
        ],
      })

      expect(response).toMatchObject({
        projectId: null,
        created: 1,
        updated: 0,
        deleted: 1,
        deletedIds: [coffeeId],
        entries: [expect.objectContaining({ title: 'Travel' })],
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('keeps project and account entries apart', async () => {
      const projectId = await seedProject(testDb.db, userId)
      const otherProjectId = await seedProject(testDb.db, userId)
      const projectEntryId = await seedEntry(testDb.db, userId, {
        projectId,
        slug: 'stack',
        title: 'Stack',
      })
      const updatedAt = await readUpdatedAt(projectEntryId)

      await expect(callApply({
        operations: [{ kind: 'delete', id: projectEntryId, updatedAt }],
      })).rejects.toMatchObject({ status: 404 })

      await expect(callApply({
        projectId: otherProjectId,
        operations: [{ kind: 'delete', id: projectEntryId, updatedAt }],
      })).rejects.toMatchObject({ status: 404 })

      expect(await callApply({
        projectId,
        operations: [{ kind: 'delete', id: projectEntryId, updatedAt }],
      })).toMatchObject({ deleted: 1 })
    })

    it('answers 404 for another user\'s project or entry', async () => {
      const otherUserId = await seedUser(testDb.db)
      const foreignProjectId = await seedProject(testDb.db, otherUserId)
      const foreignEntryId = await seedEntry(testDb.db, otherUserId)

      await expect(callApply({
        projectId: foreignProjectId,
        operations: [{
          kind: 'create',
          category: 'topics',
          title: 'Travel',
          description: 'Trips',
          body: '- Lisbon',
        }],
      })).rejects.toMatchObject({ status: 404 })

      await expect(callApply({
        operations: [{
          kind: 'delete',
          id: foreignEntryId,
          updatedAt: await readUpdatedAt(foreignEntryId),
        }],
      })).rejects.toMatchObject({ status: 404 })

      expect(await testDb.db.select().from(schema.memoryEntries))
        .toHaveLength(1)
    })

    it('rejects an invalid body', async () => {
      await expect(callApply({ operations: [] })).rejects.toMatchObject({
        status: 400,
      })
      await expect(callApply({
        operations: [{ kind: 'delete', id: 'pub-1', updatedAt: 'yesterday' }],
      })).rejects.toMatchObject({ status: 400 })
    })
  })
})
