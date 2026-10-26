import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type {
  MemoryExtractionOp,
} from '~~/server/utils/memory/extract-schema'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedEntry,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveMemoryModel: vi.fn(),
  acquireMemoryLease: vi.fn(),
  acquireProjectMemoryLease: vi.fn(),
  chatRelease: vi.fn(),
  projectRelease: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return { ...actual, generateText: mocks.generateText }
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

vi.mock('~~/server/utils/projects/memory-lease', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/projects/memory-lease')
  >()

  return {
    ...original,
    acquireMemoryLease: mocks.acquireMemoryLease,
    acquireProjectMemoryLease: mocks.acquireProjectMemoryLease,
  }
})

const USER_SENTENCE = 'I am a backend developer and I write Rust on weekends.'
const LONG_USER_TEXT = `${USER_SENTENCE} ${'I prefer concise answers. '.repeat(14)}`
const SHORT_FIRST = `I write Rust on weekends. ${'Short note one. '.repeat(8)}`
const SHORT_SECOND = 'Second chunk of context. '.repeat(8)
const BLOB = 'The user maintains a Rust CLI. Test card 4111 1111 1111 1111.'
const BLOB_NOTICE
  = 'Existing project memory could not be converted automatically; it is kept as is.'

function createSelection(modelId = 'gpt-test') {
  return {
    scope: 'project',
    source: 'fallback',
    providerId: 'openai',
    gatewayId: null,
    modelId,
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

function createOp(overrides: Partial<MemoryExtractionOp> = {}) {
  return {
    op: 'create',
    category: 'topics',
    slug: null,
    title: 'Rust hobby',
    description: 'Writes Rust on weekends',
    body: 'The user writes Rust on weekends.',
    neverStore: null,
    evidence: 'I write Rust on weekends',
    ...overrides,
  } satisfies MemoryExtractionOp
}

function mockOps(ops: MemoryExtractionOp[]) {
  mocks.generateText.mockResolvedValue({
    output: { ops },
    usage: { inputTokens: 120, outputTokens: 30 },
  })
}

describe('refreshProjectMemoryFromChats', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kvStore: Map<string, string>
  let kv: {
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {
      memoryEnabled: true,
      memoryExtractionEnabled: false,
      memoryIncludeSensitive: false,
    })
    mocks.chatRelease.mockResolvedValue(undefined)
    mocks.projectRelease.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({
      release: mocks.chatRelease,
    })
    mocks.acquireProjectMemoryLease.mockResolvedValue({
      release: mocks.projectRelease,
    })
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    mockOps([createOp()])
    kvStore = new Map()
    kv = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        kvStore.delete(key)
      }),
    }
    vi.stubGlobal('useKV', () => kv)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedProjectWithChats(
    chatTexts: string[],
    projectValues: Partial<typeof schema.projects.$inferInsert> = {},
  ) {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'stale',
      memoryDirtyAt: minutesBefore(30),
      ...projectValues,
    })
    const chatIds: string[] = []

    for (const [index, text] of chatTexts.entries()) {
      const chat = await seedChat(testDb.db, userId, {
        projectId,
        activityAt: minutesBefore(60 + index),
      })

      await seedMessage(
        testDb.db,
        chat.id,
        'user',
        [textPart(text)],
        minutesBefore(100 + index),
      )
      chatIds.push(chat.id)
    }

    return { projectId, chatIds }
  }

  async function refresh(projectId: string) {
    const { refreshProjectMemoryFromChats } = await import(
      '~~/server/utils/projects/memory-refresh'
    )

    return await refreshProjectMemoryFromChats({
      projectId,
      userId,
      db: testDb.db,
      logger: { set: vi.fn() },
    })
  }

  async function readProject(projectId: string) {
    return await testDb.db.query.projects.findFirst({
      where: { id: projectId },
    })
  }

  async function readChat(chatId: string) {
    return await testDb.db.query.chats.findFirst({ where: { id: chatId } })
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  it('extracts into entries for NULL watermarks and settles to ready', async () => {
    const { projectId, chatIds } = await seedProjectWithChats([LONG_USER_TEXT])

    const card = await refresh(projectId)
    const project = await readProject(projectId)

    expect(card).toMatchObject({
      projectId,
      memoryStatus: 'ready',
      memoryProvider: 'openai',
      memoryModel: 'gpt-test',
      memoryError: null,
      usesEntries: true,
      legacyMemory: null,
      total: 1,
    })
    expect(card.memoryUpdatedAt).toEqual(expect.any(String))
    expect(card.memoryDirtyAt).toBeNull()
    expect(project?.memoryStatus).toBe('ready')
    expect(project?.memoryDirtyAt).toBeNull()
    expect(await listEntries()).toHaveLength(1)
    expect((await readChat(chatIds[0]!))?.projectMemorySummaryUpdatedAt)
      .toEqual(minutesBefore(100))
    expect(mocks.projectRelease).toHaveBeenCalledOnce()
  })

  it('resolves the model once and passes it to every pass', async () => {
    const { projectId } = await seedProjectWithChats([
      LONG_USER_TEXT,
      LONG_USER_TEXT,
      LONG_USER_TEXT,
    ])

    await refresh(projectId)

    expect(mocks.resolveMemoryModel).toHaveBeenCalledOnce()
    expect(mocks.resolveMemoryModel).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'project', userId }),
    )
    expect(mocks.generateText).toHaveBeenCalledTimes(3)
  })

  it('processes at most six chats per click and leaves the project stale', async () => {
    const { projectId } = await seedProjectWithChats(
      Array.from({ length: 8 }, () => LONG_USER_TEXT),
    )

    const first = await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledTimes(6)
    expect(first.memoryStatus).toBe('stale')
    expect(first.memoryDirtyAt).toEqual(expect.any(String))

    kvStore.clear()

    const second = await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledTimes(8)
    expect(second.memoryStatus).toBe('ready')
    expect(second.memoryDirtyAt).toBeNull()
  })

  it('does not spend a slot on a chat that is too short', async () => {
    const { projectId } = await seedProjectWithChats([
      ...Array.from({ length: 4 }, () => 'Too short.'),
      ...Array.from({ length: 6 }, () => LONG_USER_TEXT),
    ])

    const card = await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledTimes(6)
    expect(card.memoryStatus).toBe('ready')
  })

  it('never reads a chat excluded from memory', async () => {
    const { projectId, chatIds } = await seedProjectWithChats([
      LONG_USER_TEXT,
      LONG_USER_TEXT,
    ])
    const [includedChatId, excludedChatId] = chatIds as [string, string]

    await testDb.db.update(schema.chats)
      .set({ memoryExcluded: true })
      .where(eq(schema.chats.id, excludedChatId))

    await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledOnce()
    expect((await readChat(includedChatId))?.projectMemorySummaryUpdatedAt)
      .not.toBeNull()
    expect((await readChat(excludedChatId))?.projectMemorySummaryUpdatedAt)
      .toBeNull()
  })

  it('counts a chat held by another lease as left over', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    mocks.acquireMemoryLease.mockResolvedValue(null)

    const card = await refresh(projectId)

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(card.memoryStatus).toBe('stale')
  })

  it('works with the extraction opt-in off', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('ready')
    expect(await listEntries()).toHaveLength(1)
  })

  it('refuses with 409 when memory is turned off', async () => {
    await testDb.db.update(schema.userSettings)
      .set({ memoryEnabled: false })

    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    await expect(refresh(projectId)).rejects.toMatchObject({
      status: 409,
      message: 'Memory is turned off',
      fix: 'Turn memory on in the settings.',
    })
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.acquireProjectMemoryLease).not.toHaveBeenCalled()
  })

  it('does nothing for a disabled project', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT], {
      memoryStatus: 'disabled',
    })

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('disabled')
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
    expect(mocks.acquireProjectMemoryLease).not.toHaveBeenCalled()
  })

  it('returns 404 for a project of another user', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const projectId = await seedProject(testDb.db, otherUserId)

    await expect(refresh(projectId)).rejects.toMatchObject({ status: 404 })
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('returns the current card without work while the project lease is held', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    mocks.acquireProjectMemoryLease.mockResolvedValue(null)

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('stale')
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
  })

  it('marks the project refreshing while the passes run', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])
    const observedStatuses: Array<string | undefined> = []

    mocks.generateText.mockImplementation(async () => {
      observedStatuses.push((await readProject(projectId))?.memoryStatus)

      return {
        output: { ops: [] },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    })

    await refresh(projectId)

    expect(observedStatuses).toEqual(['refreshing'])
  })

  it('marks the project unavailable without a saved key', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    mocks.resolveMemoryModel.mockResolvedValue(null)

    const card = await refresh(projectId)

    expect(card).toMatchObject({
      memoryStatus: 'unavailable',
      memoryProvider: null,
      memoryModel: null,
      memoryError: 'No saved API key is available for project memory.',
    })
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('marks the project failed with an error label when every chat fails', async () => {
    const { projectId } = await seedProjectWithChats([
      LONG_USER_TEXT,
      LONG_USER_TEXT,
    ])

    await seedEntry(testDb.db, userId, { projectId })
    mocks.generateText.mockRejectedValue(new Error('provider down: secret'))

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('failed')
    expect(card.memoryError).toBe('Error')
    expect(JSON.stringify(card)).not.toContain('provider down')
    expect(card.total).toBe(1)
  })

  it('keeps going and settles stale with the first failure label when one chat fails', async () => {
    const { projectId } = await seedProjectWithChats([
      LONG_USER_TEXT,
      LONG_USER_TEXT,
    ])

    mocks.generateText
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce({
        output: { ops: [createOp()] },
        usage: { inputTokens: 1, outputTokens: 1 },
      })

    const card = await refresh(projectId)

    expect(card).toMatchObject({
      memoryStatus: 'stale',
      memoryError: 'Error',
      total: 1,
    })
    expect(card.memoryDirtyAt).toEqual(expect.any(String))
    expect(JSON.stringify(card)).not.toContain('provider down')
  })

  it('processes a chat the opt-in stamp already covered', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'stale',
    })
    const chat = await seedChat(testDb.db, userId, {
      projectId,
      memoryExtractedAt: minutesBefore(1),
    })

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart(LONG_USER_TEXT)],
      minutesBefore(70),
    )

    await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledOnce()
    expect(await listEntries()).toHaveLength(1)
    expect((await readChat(chat.id))?.memoryExtractedAt)
      .toEqual(minutesBefore(1))
  })

  it('accumulates too-short text across clicks', async () => {
    const { projectId, chatIds } = await seedProjectWithChats([SHORT_FIRST])

    const first = await refresh(projectId)

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(first.memoryStatus).toBe('idle')
    expect((await readChat(chatIds[0]!))?.projectMemorySummaryUpdatedAt)
      .toBeNull()

    await seedMessage(
      testDb.db,
      chatIds[0]!,
      'user',
      [textPart(SHORT_SECOND)],
      minutesBefore(50),
    )

    await refresh(projectId)

    const prompt: string
      = mocks.generateText.mock.calls[0]![0].messages[0].content

    expect(prompt).toContain('Short note one.')
    expect(prompt).toContain('Second chunk of context.')
  })

  it('does not read a chat again once its text was consumed', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    await refresh(projectId)
    kvStore.clear()
    await refresh(projectId)

    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('makes the project stale again after a new message', async () => {
    const { projectId, chatIds } = await seedProjectWithChats([LONG_USER_TEXT])

    const ready = await refresh(projectId)

    expect(ready.memoryStatus).toBe('ready')

    const { markProjectsMemoryStale } = await import(
      '~~/server/utils/projects/memory'
    )

    await seedMessage(
      testDb.db,
      chatIds[0]!,
      'user',
      [textPart('One more thing about the project.')],
      minutesBefore(5),
    )
    await markProjectsMemoryStale([projectId], userId, testDb.db)

    const project = await readProject(projectId)

    expect(project?.memoryStatus).toBe('stale')
    expect(project?.memoryDirtyAt).toBeInstanceOf(Date)
  })

  it('keeps the project stale when a message arrives during the pass', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])
    const { markProjectsMemoryStale } = await import(
      '~~/server/utils/projects/memory'
    )

    mocks.generateText.mockImplementation(async () => {
      await markProjectsMemoryStale([projectId], userId, testDb.db)

      return {
        output: { ops: [createOp()] },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    })

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('stale')
    expect(card.memoryDirtyAt).toEqual(expect.any(String))
  })

  it('does not overwrite a project disabled during the pass', async () => {
    const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

    mocks.generateText.mockImplementation(async () => {
      await testDb.db.update(schema.projects)
        .set({ memoryStatus: 'disabled' })

      return {
        output: { ops: [createOp()] },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    })

    await refresh(projectId)

    expect((await readProject(projectId))?.memoryStatus).toBe('disabled')
  })

  it('settles to idle when there is nothing to read and no entry', async () => {
    const { projectId } = await seedProjectWithChats([])

    const card = await refresh(projectId)

    expect(card.memoryStatus).toBe('idle')
    expect(card.memoryDirtyAt).toBeNull()
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  describe('cooldown and deadline', () => {
    const COOLDOWN_KEY = (projectId: string) => {
      return `project-memory-refresh-cooldown:${projectId}`
    }

    it('starts a 60 second cooldown after a pass that called the model', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      await refresh(projectId)

      expect(kv.put).toHaveBeenCalledWith(
        COOLDOWN_KEY(projectId),
        expect.any(String),
        { expirationTtl: 60 },
      )
    })

    it('does not start a cooldown when no model was called', async () => {
      const { projectId } = await seedProjectWithChats([])

      await refresh(projectId)

      expect(kv.put).not.toHaveBeenCalled()
    })

    it('refuses with 429 inside the cooldown and does no work', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      await refresh(projectId)
      mocks.generateText.mockClear()
      mocks.acquireProjectMemoryLease.mockClear()

      await expect(refresh(projectId)).rejects.toMatchObject({
        status: 429,
        message: 'Project memory was refreshed moments ago',
        why: 'A refresh already ran in the last minute.',
        fix: 'Try again in a minute.',
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(mocks.acquireProjectMemoryLease).not.toHaveBeenCalled()
    })

    it('starts the cooldown even when the pass failed', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      mocks.generateText.mockRejectedValue(new Error('provider down'))

      await refresh(projectId)

      expect(kv.put).toHaveBeenCalledOnce()
    })

    it('fails open when the cooldown cannot be read or written', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      kv.get.mockRejectedValue(new Error('kv down'))
      kv.put.mockRejectedValue(new Error('kv down'))

      const card = await refresh(projectId)

      expect(card.memoryStatus).toBe('ready')
    })

    it('lets the enable toggle enable without refreshing inside the cooldown', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT], {
        memoryStatus: 'disabled',
      })

      kvStore.set(COOLDOWN_KEY(projectId), '1')

      const { toggleProjectMemory } = await import(
        '~~/server/utils/projects/memory-refresh'
      )
      const card = await toggleProjectMemory(
        projectId,
        userId,
        true,
        testDb.db,
        { set: vi.fn() },
      )

      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(card.memoryStatus).toBe('idle')
    })

    it('stops starting chat passes after the runtime deadline', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))

      try {
        const { projectId } = await seedProjectWithChats([
          LONG_USER_TEXT,
          LONG_USER_TEXT,
          LONG_USER_TEXT,
        ])

        mocks.generateText.mockImplementation(async () => {
          vi.setSystemTime(Date.now() + 61_000)

          return {
            output: { ops: [createOp()] },
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        })

        const card = await refresh(projectId)

        expect(mocks.generateText).toHaveBeenCalledTimes(1)
        expect(card.memoryStatus).toBe('stale')
        expect(card.memoryDirtyAt).toEqual(expect.any(String))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('failures', () => {
    it('sets failed, a label and releases the lease when model resolution throws', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      mocks.resolveMemoryModel.mockRejectedValue(new Error('keys lookup: secret'))

      await expect(refresh(projectId)).rejects.toMatchObject({
        status: 502,
        message: 'Project memory refresh failed',
        why: 'Error',
      })

      const project = await readProject(projectId)

      expect(project).toMatchObject({
        memoryStatus: 'failed',
        memoryError: 'Error',
      })
      expect(mocks.projectRelease).toHaveBeenCalledOnce()
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('rethrows a structured error with the class label only', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])
      const providerError = Object.assign(new Error('raw provider text'), {
        name: 'APICallError',
        status: 429,
      })

      mocks.resolveMemoryModel.mockRejectedValue(providerError)

      const exception = await refresh(projectId).catch(error => error)

      expect(exception).toMatchObject({
        status: 502,
        message: 'Project memory refresh failed',
        why: 'APICallError:429',
      })
      expect(JSON.stringify(exception)).not.toContain('raw provider text')
      expect(exception.message).not.toContain('raw provider text')
    })

    it('releases the lease and marks the project failed when a chat pass throws', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])
      mocks.acquireMemoryLease.mockRejectedValue(new Error('kv put failed'))

      await expect(refresh(projectId)).rejects.toMatchObject({ status: 502 })
      expect(mocks.projectRelease).toHaveBeenCalledOnce()
      expect((await readProject(projectId))?.memoryStatus).toBe('failed')
    })
  })

  describe('legacy blob', () => {
    it('converts the blob first and marks it migrated', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT], {
        memory: BLOB,
        memoryStatus: 'ready',
      })

      mocks.generateText.mockImplementation(async (options: {
        messages: Array<{ content: string }>
      }) => {
        const isBlobPass = options.messages[0]!.content
          .includes('(no chat messages)')

        return {
          output: {
            ops: [
              isBlobPass
                ? createOp({
                  title: 'Rust CLI',
                  description: 'Maintains a Rust CLI',
                  body: 'The user maintains a Rust CLI.',
                  evidence: 'maintains a Rust CLI',
                })
                : createOp(),
            ],
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      })

      const card = await refresh(projectId)
      const project = await readProject(projectId)

      expect(mocks.generateText).toHaveBeenCalledTimes(2)
      expect(mocks.generateText.mock.calls[0]![0].messages[0].content)
        .toContain('(no chat messages)')
      expect(project?.memoryMigratedAt).toBeInstanceOf(Date)
      expect(project?.memory).toContain('[redacted]')
      expect(card).toMatchObject({
        usesEntries: true,
        legacyMemory: null,
        memoryError: null,
        memoryStatus: 'ready',
        total: 2,
      })
    })

    it('keeps the marker null and shows a notice when no op applied', async () => {
      const { projectId } = await seedProjectWithChats([], {
        memory: BLOB,
        memoryStatus: 'ready',
      })

      mockOps([])

      const card = await refresh(projectId)
      const project = await readProject(projectId)

      expect(project?.memoryMigratedAt).toBeNull()
      expect(project?.memory).toContain('Rust CLI')
      expect(card).toMatchObject({
        memoryStatus: 'idle',
        memoryError: BLOB_NOTICE,
        usesEntries: false,
      })
      expect(card.legacyMemory).toContain('Rust CLI')
    })

    it('marks a blank blob migrated without a model call', async () => {
      const { projectId } = await seedProjectWithChats([], {
        memory: '4111 1111 1111 1111',
      })

      const card = await refresh(projectId)

      expect(mocks.generateText).not.toHaveBeenCalled()
      expect((await readProject(projectId))?.memoryMigratedAt)
        .toBeInstanceOf(Date)
      expect(card.memoryError).toBeNull()
    })

    it('never nulls the blob when the blob pass fails', async () => {
      const { projectId } = await seedProjectWithChats([], { memory: BLOB })

      mocks.generateText.mockRejectedValue(new Error('provider down'))

      const card = await refresh(projectId)

      expect((await readProject(projectId))?.memory).toBe(BLOB)
      expect(card.memoryError).toBe(BLOB_NOTICE)
    })

    it('does not run a blob pass for an already migrated project', async () => {
      const { projectId } = await seedProjectWithChats([], {
        memory: BLOB,
        memoryMigratedAt: minutesBefore(1000),
      })

      await refresh(projectId)

      expect(mocks.generateText).not.toHaveBeenCalled()
    })
  })

  describe('toggleProjectMemory', () => {
    async function toggle(projectId: string, enabled: boolean) {
      const { toggleProjectMemory } = await import(
        '~~/server/utils/projects/memory-refresh'
      )

      return await toggleProjectMemory(
        projectId,
        userId,
        enabled,
        testDb.db,
        { set: vi.fn() },
      )
    }

    it('keeps the entries and the blob but clears the lifecycle fields when disabling', async () => {
      const { projectId } = await seedProjectWithChats([], {
        memory: BLOB,
        memoryStatus: 'ready',
        memoryProvider: 'openai',
        memoryModel: 'gpt-test',
        memoryUpdatedAt: minutesBefore(10),
      })

      await seedEntry(testDb.db, userId, { projectId })

      const card = await toggle(projectId, false)
      const project = await readProject(projectId)

      expect(card).toMatchObject({
        memoryStatus: 'disabled',
        memoryProvider: null,
        memoryModel: null,
        memoryUpdatedAt: null,
        total: 1,
      })
      expect(project?.memory).toBe(BLOB)
      expect(await listEntries()).toHaveLength(1)
    })

    it('runs the explicit refresh when enabling with memory on', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT], {
        memoryStatus: 'disabled',
      })

      const card = await toggle(projectId, true)

      expect(mocks.generateText).toHaveBeenCalledOnce()
      expect(card).toMatchObject({ memoryStatus: 'ready', total: 1 })
    })

    it('enables without a refresh and without throwing when memory is off', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryEnabled: false })

      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT], {
        memoryStatus: 'disabled',
      })

      await seedEntry(testDb.db, userId, { projectId })

      const card = await toggle(projectId, true)

      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(card.memoryStatus).toBe('ready')
    })

    it('leaves an enabled project alone when enabling again', async () => {
      const { projectId } = await seedProjectWithChats([LONG_USER_TEXT])

      const card = await toggle(projectId, true)

      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(card.memoryStatus).toBe('stale')
    })

    it('returns 404 for an unknown project', async () => {
      const otherUserId = await seedUser(testDb.db, {})
      const projectId = await seedProject(testDb.db, otherUserId)

      await expect(toggle(projectId, true)).rejects.toMatchObject({
        status: 404,
      })
    })
  })
})
