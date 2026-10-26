import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { MEMORY_LIMITS, SENSITIVE_TOPIC_REFUSAL_MESSAGE } from '#shared/utils/memory-policy'
import type { MemoryInstructPreviewOperation } from '#shared/types/memory-instruct.d'
import type { MemoryInstructApplyOperation } from '#shared/utils/memory-instruct'
import type { MemoryInstructModelOp } from '~~/server/utils/memory/instruct-prompt'
import {
  createMemoryExtractionTestDb,
  seedEntry,
  seedProject,
  seedUser,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveMemoryModel: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()

  return { ...original, generateText: mocks.generateText }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/memory/resolve-model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/resolve-model')
  >()

  return { ...original, resolveMemoryModel: mocks.resolveMemoryModel }
})

const CARD_NUMBER = '4111 1111 1111 1111'

function createSelection() {
  return {
    scope: 'profile',
    source: 'setting',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
    instantiate: vi.fn(async () => {
      return {
        model: { id: 'mock-model' },
        reasoning: undefined,
        providerOptions: { openai: { reasoningEffort: 'low' } },
      }
    }),
  }
}

function createOp(
  overrides: Partial<MemoryInstructModelOp> = {},
): MemoryInstructModelOp {
  return {
    op: 'create',
    ref: null,
    category: 'topics',
    title: 'Travel',
    description: 'Trips the user plans',
    body: '- Plans a trip to Lisbon in May',
    reason: null,
    evidence: null,
    ...overrides,
  }
}

function mockOps(ops: MemoryInstructModelOp[]) {
  mocks.generateText.mockResolvedValue({
    output: { ops },
    usage: { inputTokens: 90, outputTokens: 25 },
  })
}

function promptContent(): string {
  return mocks.generateText.mock.calls[0]![0].messages[0].content
}

describe('memory instruct', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    loggerSet = vi.fn()
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    mockOps([])
  })

  afterEach(() => {
    testDb.close()
  })

  async function preview(text: string, projectId: string | null = null) {
    const { previewMemoryInstruction } = await import(
      '~~/server/utils/memory/instruct'
    )

    return await previewMemoryInstruction({
      db: testDb.db as never,
      userId,
      projectId,
      text,
      logger: { set: loggerSet },
    })
  }

  async function previewOperations(
    text: string,
    projectId: string | null = null,
  ): Promise<MemoryInstructPreviewOperation[]> {
    const result = await preview(text, projectId)

    if (result.status !== 'ready') {
      throw new Error(`Preview was ${result.status}`)
    }

    return result.response.operations
  }

  async function apply(
    operations: MemoryInstructApplyOperation[],
    projectId: string | null = null,
  ) {
    const { applyMemoryInstruction } = await import(
      '~~/server/utils/memory/instruct-apply'
    )

    return await applyMemoryInstruction({
      db: testDb.db as never,
      userId,
      projectId,
      operations,
      logger: { set: loggerSet },
    })
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  describe('preview', () => {
    it('proposes a new entry without writing anything', async () => {
      mockOps([createOp()])

      const result = await preview('I am planning a trip to Lisbon in May')

      expect(result.status).toBe('ready')

      if (result.status !== 'ready') {
        return
      }

      expect(result.response.operations).toEqual([
        expect.objectContaining({
          kind: 'create',
          status: 'ready',
          category: 'topics',
          after: {
            title: 'Travel',
            description: 'Trips the user plans',
            body: '- Plans a trip to Lisbon in May',
          },
        }),
      ])
      expect(result.response.model).toMatchObject({
        modelId: 'gpt-test',
        modelName: 'GPT Test',
      })
      expect(result.response.capacity).toEqual({
        total: 0,
        limit: MEMORY_LIMITS.maxAccountEntries,
      })
      expect(await listEntries()).toHaveLength(0)
    })

    it('merges into an existing topic and shows its body to the model',
      async () => {
        const entryId = await seedEntry(testDb.db, userId, {
          slug: 'coffee',
          title: 'Coffee',
          description: 'Coffee habits',
          body: '- Drinks two flat whites a day',
          origin: 'user',
        })

        mockOps([createOp({
          op: 'update',
          ref: 'topics/coffee',
          category: null,
          title: null,
          description: null,
          body: '- Drinks two flat whites a day\n- Prefers oat milk',
        })])

        const operations = await previewOperations(
          'Add that I prefer oat milk in my coffee',
        )

        expect(promptContent()).toContain('Drinks two flat whites a day')
        expect(promptContent()).toContain('ref="topics/coffee"')
        expect(operations).toEqual([
          expect.objectContaining({
            kind: 'update',
            status: 'ready',
            id: entryId,
            before: expect.objectContaining({
              body: '- Drinks two flat whites a day',
            }),
            after: expect.objectContaining({
              title: 'Coffee',
              body: '- Drinks two flat whites a day\n- Prefers oat milk',
            }),
          }),
        ])
      })

    it('only adds lines to an entry whose body was not shown', async () => {
      await seedEntry(testDb.db, userId, {
        slug: 'garden',
        title: 'Garden',
        description: 'Garden plans',
        body: '- Grows tomatoes',
      })

      mockOps([createOp({
        op: 'update',
        ref: 'topics/garden',
        body: '- Planted basil',
      })])

      const operations = await previewOperations('I moved to Kraków')

      expect(promptContent()).not.toContain('Grows tomatoes')
      expect(operations[0]).toMatchObject({
        kind: 'update',
        status: 'ready',
        after: { body: '- Grows tomatoes\n- Planted basil' },
      })
    })

    it('turns a create of an existing profile into an update that adds '
      + 'its bullets', async () => {
      const profileId = await seedEntry(testDb.db, userId, {
        category: 'profile',
        slug: 'profile',
        title: 'Profile',
        description: 'Who the user is',
        body: '- Lives in Warsaw',
      })

      mockOps([createOp({
        category: 'profile',
        title: 'About me',
        description: 'About the user',
        body: '- Lives in Kraków',
      })])

      const operations = await previewOperations('I moved to Kraków')

      expect(operations[0]).toMatchObject({
        kind: 'update',
        status: 'ready',
        id: profileId,
        after: {
          title: 'Profile',
          body: '- Lives in Warsaw\n- Lives in Kraków',
        },
      })
    })

    it('keeps a delete the user explicitly asked for', async () => {
      const entryId = await seedEntry(testDb.db, userId, {
        slug: 'coffee',
        title: 'Coffee',
        description: 'Coffee habits',
        body: '- Drinks two flat whites a day',
      })

      mockOps([createOp({
        op: 'delete',
        ref: 'topics/coffee',
        reason: 'You asked to forget your coffee habits.',
        evidence: 'Forget the coffee thing',
      })])

      const operations = await previewOperations(
        'I moved to Kraków. Forget the coffee thing.',
      )

      expect(operations).toEqual([
        expect.objectContaining({
          kind: 'delete',
          status: 'ready',
          id: entryId,
          reason: 'You asked to forget your coffee habits.',
          after: null,
        }),
      ])
      expect(await listEntries()).toHaveLength(1)
    })

    it('refuses a delete the text does not explicitly ask for', async () => {
      await seedEntry(testDb.db, userId, {
        slug: 'coffee',
        title: 'Coffee',
        description: 'Coffee habits',
        body: '- Drinks two flat whites a day',
      })

      mockOps([
        createOp({
          op: 'delete',
          ref: 'topics/coffee',
          reason: 'Looks outdated',
          evidence: 'coffee is no longer relevant',
        }),
      ])

      const withQuote = await previewOperations('I moved to Kraków')

      mockOps([
        createOp({ op: 'delete', ref: 'topics/coffee', evidence: null }),
      ])

      const withoutQuote = await previewOperations('I moved to Kraków')

      for (const operations of [withQuote, withoutQuote]) {
        expect(operations).toEqual([
          expect.objectContaining({
            kind: 'delete',
            status: 'rejected',
            rejection: expect.objectContaining({ message: 'Not removed' }),
          }),
        ])
      }
    })

    it('rejects a sensitive item with the 422 reason', async () => {
      mockOps([createOp({
        title: 'Health',
        description: 'Health condition',
        body: '- Has type 2 diabetes',
      })])

      const operations = await previewOperations('I have type 2 diabetes')

      expect(operations[0]).toMatchObject({
        kind: 'create',
        status: 'rejected',
        rejection: { message: SENSITIVE_TOPIC_REFUSAL_MESSAGE },
      })
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: {
            sensitive: expect.objectContaining({ origin: 'memory-instruct' }),
          },
        },
      })
    })

    it('redacts never-store data before the model sees the text',
      async () => {
        mockOps([])

        const result = await preview(`My card is ${CARD_NUMBER}, I like tea`)

        expect(promptContent()).not.toContain(CARD_NUMBER)
        expect(result).toMatchObject({
          status: 'ready',
          response: { blocked: { 'payment-card': 1 } },
        })
      })

    it('rejects new entries past the entry cap', async () => {
      for (let index = 0; index < MEMORY_LIMITS.maxAccountEntries; index++) {
        await seedEntry(testDb.db, userId, {
          slug: `entry-${index}`,
          title: `Entry ${index}`,
        })
      }

      mockOps([createOp()])

      const operations = await previewOperations('Remember my Lisbon trip')

      expect(operations[0]).toMatchObject({
        kind: 'create',
        status: 'rejected',
        rejection: { message: 'Memory limit reached' },
      })
    })

    it('rejects ops on unknown refs and a second op on the same entry',
      async () => {
        await seedEntry(testDb.db, userId, {
          slug: 'coffee',
          title: 'Coffee',
          description: 'Coffee habits',
          body: '- Drinks coffee',
        })

        mockOps([
          createOp({ op: 'update', ref: 'topics/missing', body: '- x' }),
          createOp({ op: 'update', ref: 'topics/coffee', body: '- Tea' }),
          createOp({
            op: 'update',
            ref: 'topics/coffee',
            body: '- Water',
          }),
        ])

        const operations = await previewOperations('Coffee became tea')

        expect(operations.map(operation => operation.status)).toEqual([
          'rejected',
          'ready',
          'rejected',
        ])
      })

    it('only sees entries of its own scope', async () => {
      const projectId = await seedProject(testDb.db, userId)

      await seedEntry(testDb.db, userId, {
        slug: 'account-topic',
        title: 'Account topic',
      })
      await seedEntry(testDb.db, userId, {
        projectId,
        slug: 'project-topic',
        title: 'Project topic',
      })

      mockOps([
        createOp({ op: 'delete', ref: 'topics/account-topic' }),
      ])

      const operations = await previewOperations('Forget it all', projectId)

      expect(promptContent()).toContain('Project topic')
      expect(promptContent()).not.toContain('Account topic')
      expect(operations[0]).toMatchObject({
        status: 'rejected',
        rejection: { message: 'Memory entry not found' },
      })
    })

    it('reports no-model when no key resolves a model', async () => {
      mocks.resolveMemoryModel.mockResolvedValue(null)

      expect(await preview('I moved to Kraków')).toEqual({
        status: 'no-model',
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('reports a failed model call without throwing', async () => {
      mocks.generateText.mockRejectedValue(
        Object.assign(new Error('boom'), { status: 401 }),
      )

      expect(await preview('I moved to Kraków')).toMatchObject({
        status: 'failed',
        reason: 'Error:401',
      })
    })
  })

  describe('apply', () => {
    it('creates, updates and deletes in one go', async () => {
      const coffeeId = await seedEntry(testDb.db, userId, {
        slug: 'coffee',
        title: 'Coffee',
        description: 'Coffee habits',
        body: '- Drinks coffee',
      })
      const gardenId = await seedEntry(testDb.db, userId, {
        slug: 'garden',
        title: 'Garden',
        description: 'Garden plans',
        body: '- Grows tomatoes',
      })
      const [coffee, garden] = await Promise.all([
        testDb.db.query.memoryEntries.findFirst({ where: { id: coffeeId } }),
        testDb.db.query.memoryEntries.findFirst({ where: { id: gardenId } }),
      ])

      const result = await apply([
        {
          kind: 'create',
          category: 'topics',
          title: 'Travel',
          description: 'Trips the user plans',
          body: '- Lisbon in May',
        },
        {
          kind: 'update',
          id: gardenId,
          updatedAt: garden!.updatedAt.toISOString(),
          title: 'Garden',
          description: 'Garden plans',
          body: '- Grows tomatoes\n- Planted basil',
        },
        {
          kind: 'delete',
          id: coffeeId,
          updatedAt: coffee!.updatedAt.toISOString(),
        },
      ])

      expect(result).toMatchObject({
        created: 1,
        updated: 1,
        deleted: 1,
        skipped: 0,
        deletedIds: [coffeeId],
      })

      const entries = await listEntries()

      expect(entries.map(entry => entry.slug).sort()).toEqual([
        'garden',
        'travel',
      ])
      expect(entries.find(entry => entry.slug === 'garden')).toMatchObject({
        body: '- Grows tomatoes\n- Planted basil',
        origin: 'user',
      })
      expect(entries.find(entry => entry.slug === 'travel')).toMatchObject({
        origin: 'user',
        projectId: null,
      })
    })

    it('refuses a stale updatedAt and writes nothing', async () => {
      const entryId = await seedEntry(testDb.db, userId, {
        slug: 'garden',
        title: 'Garden',
        description: 'Garden plans',
        body: '- Grows tomatoes',
        updatedAt: new Date('2026-10-01T10:00:00.000Z'),
      })

      await testDb.db.update(schema.memoryEntries)
        .set({
          body: '- Edited elsewhere',
          updatedAt: new Date('2026-10-02T10:00:00.000Z'),
        })
        .where(eq(schema.memoryEntries.id, entryId))

      await expect(apply([
        {
          kind: 'create',
          category: 'topics',
          title: 'Travel',
          description: 'Trips the user plans',
          body: '- Lisbon',
        },
        {
          kind: 'update',
          id: entryId,
          updatedAt: '2026-10-01T10:00:00.000Z',
          title: 'Garden',
          description: 'Garden plans',
          body: '- Planted basil',
        },
      ])).rejects.toMatchObject({ status: 409 })

      const entries = await listEntries()

      expect(entries).toHaveLength(1)
      expect(entries[0]!.body).toBe('- Edited elsewhere')
    })

    it('refuses a create past the entry cap', async () => {
      for (let index = 0; index < MEMORY_LIMITS.maxAccountEntries; index++) {
        await seedEntry(testDb.db, userId, {
          slug: `entry-${index}`,
          title: `Entry ${index}`,
        })
      }

      await expect(apply([{
        kind: 'create',
        category: 'topics',
        title: 'Travel',
        description: 'Trips the user plans',
        body: '- Lisbon',
      }])).rejects.toMatchObject({
        status: 409,
        message: 'Memory limit reached',
      })
    })

    it('re-runs the compliance gate', async () => {
      await expect(apply([{
        kind: 'create',
        category: 'topics',
        title: 'Health',
        description: 'Health condition',
        body: '- Has type 2 diabetes',
      }])).rejects.toMatchObject({ status: 422 })

      await expect(apply([{
        kind: 'create',
        category: 'topics',
        title: 'Card',
        description: 'Payment card',
        body: `- Card ${CARD_NUMBER}`,
      }])).rejects.toMatchObject({ status: 422 })

      expect(await listEntries()).toHaveLength(0)
    })

    it('keeps profile single', async () => {
      await seedEntry(testDb.db, userId, {
        category: 'profile',
        slug: 'profile',
        title: 'Profile',
        description: 'Who the user is',
        body: '- Lives in Warsaw',
      })

      await expect(apply([{
        kind: 'create',
        category: 'profile',
        title: 'Profile',
        description: 'Who the user is',
        body: '- Lives in Kraków',
      }])).rejects.toMatchObject({ status: 409 })
    })

    it('never touches entries of another scope or user', async () => {
      const projectId = await seedProject(testDb.db, userId)
      const accountEntryId = await seedEntry(testDb.db, userId, {
        slug: 'account-topic',
        title: 'Account topic',
      })
      const otherUserId = await seedUser(testDb.db)
      const foreignEntryId = await seedEntry(testDb.db, otherUserId, {
        slug: 'foreign',
        title: 'Foreign',
      })
      const foreignProjectId = await seedProject(testDb.db, otherUserId)
      const [accountEntry, foreignEntry] = await Promise.all([
        testDb.db.query.memoryEntries.findFirst({
          where: { id: accountEntryId },
        }),
        testDb.db.query.memoryEntries.findFirst({
          where: { id: foreignEntryId },
        }),
      ])

      await expect(apply([{
        kind: 'delete',
        id: accountEntryId,
        updatedAt: accountEntry!.updatedAt.toISOString(),
      }], projectId)).rejects.toMatchObject({ status: 404 })

      await expect(apply([{
        kind: 'delete',
        id: foreignEntryId,
        updatedAt: foreignEntry!.updatedAt.toISOString(),
      }])).rejects.toMatchObject({ status: 404 })

      await expect(apply([{
        kind: 'create',
        category: 'topics',
        title: 'Travel',
        description: 'Trips',
        body: '- Lisbon',
      }], foreignProjectId)).rejects.toMatchObject({ status: 404 })

      expect(await listEntries()).toHaveLength(2)
    })

    it('creates project entries in that project only', async () => {
      const projectId = await seedProject(testDb.db, userId)

      const result = await apply([{
        kind: 'create',
        category: 'topics',
        title: 'Deadline',
        description: 'Project deadline',
        body: '- Deadline is 15 Nov',
      }], projectId)

      expect(result.entries).toEqual([
        expect.objectContaining({ projectId, title: 'Deadline' }),
      ])
    })

    it('refuses to change the same entry twice', async () => {
      const entryId = await seedEntry(testDb.db, userId)
      const entry = await testDb.db.query.memoryEntries.findFirst({
        where: { id: entryId },
      })
      const updatedAt = entry!.updatedAt.toISOString()

      await expect(apply([
        { kind: 'delete', id: entryId, updatedAt },
        {
          kind: 'update',
          id: entryId,
          updatedAt,
          title: 'Seeded',
          description: 'Seeded entry',
          body: '- New',
        },
      ])).rejects.toMatchObject({ status: 400 })
    })
  })
})
