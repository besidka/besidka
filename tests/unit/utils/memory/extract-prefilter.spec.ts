import { APICallError } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_EXTRACTION_PREFILTER } from '#shared/utils/jev-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import * as schema from '~~/server/db/schema'
import { splitMemoryExtractionTranscript } from '~~/server/utils/memory/extract-prefilter'
import type {
  MemoryExtractionOp,
} from '~~/server/utils/memory/extract-schema'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedKey,
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
  decide: vi.fn(),
  getModel: vi.fn(),
  getCachedGatewayCatalog: vi.fn(),
  resolveMemoryModel: vi.fn(),
  acquireMemoryLease: vi.fn(),
  release: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    generateText: mocks.generateText,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('#shared/utils/model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('#shared/utils/model')
  >()

  return { ...original, getModel: mocks.getModel }
})

vi.mock('~~/server/utils/gateways/catalog', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/gateways/catalog')
  >()

  return {
    ...original,
    getCachedGatewayCatalog: mocks.getCachedGatewayCatalog,
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: async (value: string) => `decrypted-${value}`,
}))

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

  return { ...original, acquireMemoryLease: mocks.acquireMemoryLease }
})

const LONG_USER_TEXT = 'I am a backend developer and I write Rust on '
  + `weekends. ${'I prefer concise answers. '.repeat(14)}`
const TASK_USER_TEXT = 'Please rewrite this function to use early returns '
  + `and keep the public signature. ${'Keep the tests passing. '.repeat(14)}`
const CHUNK_MESSAGE_CHARS = 2900
const CHUNK_MESSAGE_COUNT = 11
const SKIP_BELOW = JEV_EXTRACTION_PREFILTER.skipBelow
const LOW_SCORE = 0.1
const BELOW_THRESHOLD = 0.39
const QUESTION_ID = JEV_EXTRACTION_PREFILTER.questionId

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

function answer(score: number) {
  return {
    answers: { [QUESTION_ID]: { type: 'boolean', probability: score } },
    usage: { inputTokens: 700 },
  }
}

function mockScores(...scores: number[]) {
  for (const score of scores) {
    mocks.decide.mockResolvedValueOnce(answer(score))
  }
}

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function numberedWords(seed: number): string {
  const words: string[] = []

  for (let index = 0; words.join(' ').length < CHUNK_MESSAGE_CHARS; index++) {
    words.push(`topic${seed}word${index}`)
  }

  return words.join(' ').slice(0, CHUNK_MESSAGE_CHARS)
}

describe('extractChatMemory pre-filter', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {
      memoryEnabled: true,
      memoryExtractionEnabledAt: minutesBefore(1000),
      typesafeRoles: { memoryChecks: false },
    })
    loggerSet = vi.fn()
    mocks.generateText.mockReset()
    mocks.decide.mockReset()
    mocks.getModel.mockReturnValue({
      modelName: 'Select Model',
      model: null,
      provider: null,
    })
    mocks.getCachedGatewayCatalog.mockResolvedValue([])
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
    mocks.resolveMemoryModel.mockReset()
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    mockOps([])
  })

  afterEach(() => {
    testDb.close()
  })

  async function seedChatWithText(
    text: string,
    options: {
      projectId?: string
      chatValues?: Partial<typeof schema.chats.$inferInsert>
    } = {},
  ) {
    const chat = await seedChat(testDb.db, userId, {
      projectId: options.projectId,
      activityAt: minutesBefore(60),
      ...options.chatValues,
    })

    await seedMessage(testDb.db, chat.id, 'user', [textPart(text)],
      minutesBefore(70))
    await seedMessage(testDb.db, chat.id, 'assistant',
      [textPart('Done.')], minutesBefore(69))

    return chat
  }

  async function seedLongChat() {
    const chat = await seedChat(testDb.db, userId, {
      activityAt: minutesBefore(60),
    })

    for (let index = 0; index < CHUNK_MESSAGE_COUNT; index++) {
      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(numberedWords(index))], minutesBefore(100 - index))
    }

    return chat
  }

  async function run(
    chat: { id: string },
    overrides: Record<string, unknown> = {},
  ) {
    const { extractChatMemory } = await import(
      '~~/server/utils/memory/extract'
    )
    const stored = overrides.trigger === 'manual'
      ? await readChat(chat.id)
      : null

    return await extractChatMemory({
      chat,
      userId,
      db: testDb.db,
      logger: { set: loggerSet },
      now: EXTRACTION_NOW,
      ...(stored?.projectId ? { expectedProjectId: stored.projectId } : {}),
      ...overrides,
    })
  }

  async function readChat(chatId: string) {
    return await testDb.db.query.chats.findFirst({ where: { id: chatId } })
  }

  async function seedTypesafeKey() {
    await seedKey(testDb.db, userId, 'typesafe')
  }

  function loggedPrefilter(): Record<string, any> {
    const merged: Record<string, any> = {}

    for (const [fields] of loggerSet.mock.calls) {
      const logged = fields?.attributes?.extractionPrefilterJev

      if (logged) {
        Object.assign(merged, logged, {
          counts: { ...merged.counts, ...logged.counts },
        })
      }
    }

    return merged
  }

  describe('with a TypeSafe AI key', () => {
    beforeEach(async () => {
      await seedTypesafeKey()
    })

    it('skips a chat scored below the threshold without calling the model '
      + 'and stamps it like no-user-text', async () => {
      const chat = await seedChatWithText(TASK_USER_TEXT)

      await testDb.db.update(schema.chats).set({
        memoryExtractionAttemptedAt: minutesBefore(40),
        memoryExtractionFailures: 2,
      }).where(eq(schema.chats.id, chat.id))
      mockScores(LOW_SCORE)

      const result = await run(chat)

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'nothing-durable',
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
      expect(mocks.decide).toHaveBeenCalledOnce()

      const stamped = await readChat(chat.id)

      expect(stamped?.memoryExtractedAt)
        .toEqual(new Date(EXTRACTION_NOW.getTime() - 1000))
      expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
      expect(stamped?.memoryExtractionFailures).toBeNull()
      expect(await testDb.db.select().from(schema.memoryEntries))
        .toHaveLength(0)
    })

    it('sends the redacted transcript with the policy question and logs '
      + 'counts and scores only', async () => {
      const chat = await seedChatWithText(
        `${TASK_USER_TEXT} My card is 4111 1111 1111 1111.`,
      )

      mockScores(LOW_SCORE)
      await run(chat)

      const call = mocks.decide.mock.calls[0]![0]

      expect(call.questions).toEqual({
        [QUESTION_ID]: JEV_EXTRACTION_PREFILTER.question,
      })
      expect(call.state.transcript).toContain('rewrite this function')
      expect(call.state.transcript).not.toContain('4111')
      expect(call.maxRetries).toBe(0)
      expect(call.abortSignal).toBeInstanceOf(AbortSignal)

      const logged = loggedPrefilter()

      expect(logged).toMatchObject({
        status: 'ok',
        calls: 1,
        scores: [LOW_SCORE],
        counts: { skipped: 1 },
      })
      expect(JSON.stringify(loggerSet.mock.calls))
        .not.toContain('rewrite this function')
    })

    it('skips just below the threshold and extracts at it', async () => {
      const skippedChat = await seedChatWithText(TASK_USER_TEXT)

      mockScores(BELOW_THRESHOLD)

      expect((await run(skippedChat)).status).toBe('skipped')
      expect(mocks.generateText).not.toHaveBeenCalled()

      const extractedChat = await seedChatWithText(LONG_USER_TEXT)

      mockScores(SKIP_BELOW)

      expect((await run(extractedChat)).status).toBe('extracted')
      expect(mocks.generateText).toHaveBeenCalledOnce()
    })

    it('extracts a chat scored above the threshold and logs the entries '
      + 'next to the score', async () => {
      const chat = await seedChatWithText(LONG_USER_TEXT)

      mockOps([createOp()])
      mockScores(0.93)

      const result = await run(chat)

      expect(result).toMatchObject({
        status: 'extracted',
        applied: { created: 1, updated: 0, deleted: 0 },
      })
      expect(mocks.generateText).toHaveBeenCalledOnce()
      expect(loggedPrefilter()).toMatchObject({
        scores: [0.93],
        counts: {
          'chatsAtScore0.9': 1,
          'proposedAtScore0.9': 1,
          'entriesAtScore0.9': 1,
        },
      })
      expect(loggedPrefilter().counts.skipped).toBeUndefined()
    })

    it('logs zero entries for an extracted chat that produced none',
      async () => {
        const chat = await seedChatWithText(LONG_USER_TEXT)

        mockScores(0.45)

        await run(chat)

        expect(loggedPrefilter().counts).toMatchObject({
          'chatsAtScore0.4': 1,
          'entriesAtScore0.4': 0,
        })
      })

    it('never pre-filters an explicit extract-now pass', async () => {
      const chat = await seedChatWithText(TASK_USER_TEXT)

      const result = await run(chat, { explicit: true, ignoreIdle: true })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(result.status).toBe('extracted')
      expect(mocks.generateText).toHaveBeenCalledOnce()
    })

    it('does not call Jev for a window that is too short', async () => {
      const chat = await seedChatWithText('I like Rust.')

      const result = await run(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'too-short' })
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('does not pre-filter a project pass that still carries the legacy '
      + 'blob', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memory: 'The user maintains a Rust CLI.',
        memoryStatus: 'ready',
      })
      const chat = await seedChatWithText(TASK_USER_TEXT, { projectId })

      const result = await run(chat)

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(result.status).toBe('extracted')
    })

    it('pre-filters a manual project Refresh and stamps the project '
      + 'watermark', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'ready',
        memoryMigratedAt: minutesBefore(500),
      })
      const chat = await seedChatWithText(TASK_USER_TEXT, { projectId })

      mockScores(LOW_SCORE)

      const result = await run(chat, { trigger: 'manual' })

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'nothing-durable',
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toEqual(new Date(EXTRACTION_NOW.getTime() - 1000))
    })

    describe('backfill', () => {
      it('skips a chat with nothing durable and stamps only a null '
        + 'watermark, with the model never resolved', async () => {
        const chat = await seedChatWithText(TASK_USER_TEXT)

        mockScores(LOW_SCORE)

        const result = await run(chat, {
          trigger: 'backfill',
          ignoreIdle: true,
          selection: createSelection(),
        })

        expect(result).toMatchObject({
          status: 'skipped',
          reason: 'nothing-durable',
        })
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect((await readChat(chat.id))?.memoryExtractedAt)
          .toEqual(minutesBefore(69))
      })

      it('keeps an existing watermark when it skips', async () => {
        const existingStamp = minutesBefore(30)
        const chat = await seedChatWithText(TASK_USER_TEXT, {
          chatValues: { memoryExtractedAt: existingStamp },
        })

        await seedMessage(testDb.db, chat.id, 'user',
          [textPart(TASK_USER_TEXT)], minutesBefore(80))
        mockScores(LOW_SCORE)

        await run(chat, {
          trigger: 'backfill',
          ignoreIdle: true,
          selection: createSelection(),
        })

        expect((await readChat(chat.id))?.memoryExtractedAt)
          .toEqual(existingStamp)
      })

      it('extracts a chat with something durable', async () => {
        const chat = await seedChatWithText(LONG_USER_TEXT)

        mockScores(0.8)
        mockOps([createOp()])

        const result = await run(chat, {
          trigger: 'backfill',
          ignoreIdle: true,
          selection: createSelection(),
        })

        expect(result.status).toBe('extracted')
        expect(mocks.generateText).toHaveBeenCalledOnce()
      })
    })

    describe('long transcripts', () => {
      function chunkTokenCounts(): number[] {
        return mocks.decide.mock.calls.map(([call]) => {
          return estimateMemoryTokens(call.state.transcript)
        })
      }

      it('scores every chunk within the token cap and skips when all are '
        + 'low', async () => {
        const chat = await seedLongChat()

        mockScores(LOW_SCORE, 0.2, 0.05)

        const result = await run(chat)

        expect(result).toMatchObject({
          status: 'skipped',
          reason: 'nothing-durable',
        })
        expect(mocks.decide.mock.calls.length).toBeGreaterThan(1)

        for (const tokens of chunkTokenCounts()) {
          expect(tokens)
            .toBeLessThanOrEqual(JEV_EXTRACTION_PREFILTER.maxChunkTokens)
        }

        expect(mocks.generateText).not.toHaveBeenCalled()
      })

      it('extracts when only the last chunk is high', async () => {
        const chat = await seedLongChat()

        mockScores(LOW_SCORE, 0.7)

        const result = await run(chat)

        expect(result.status).toBe('extracted')
        expect(mocks.decide).toHaveBeenCalledTimes(2)
        expect(mocks.generateText).toHaveBeenCalledOnce()
        expect(loggedPrefilter().scores).toEqual([LOW_SCORE, 0.7])
      })

      it('stops at the first high chunk', async () => {
        const chat = await seedLongChat()

        mockScores(0.8, LOW_SCORE)

        const result = await run(chat)

        expect(result.status).toBe('extracted')
        expect(mocks.decide).toHaveBeenCalledOnce()
      })

      it('extracts when one chunk fails after another scored low',
        async () => {
          const chat = await seedLongChat()

          mockScores(LOW_SCORE)
          mocks.decide.mockRejectedValueOnce(apiError(429))

          const result = await run(chat)

          expect(result.status).toBe('extracted')
          expect(loggedPrefilter().status).toBe('rate-limited')
          expect(loggedPrefilter().counts?.skipped).toBeUndefined()
        })
    })

    describe('failures extract as before', () => {
      it.each([
        ['a 401', () => apiError(401), 'unauthorized'],
        ['a 429', () => apiError(429), 'rate-limited'],
        ['a 529', () => apiError(529), 'rate-limited'],
        ['a timeout', () => {
          return new DOMException('timed out', 'TimeoutError')
        }, 'timeout'],
        ['a network error', () => new TypeError('fetch failed'), 'network'],
      ])('runs the extraction after %s', async (_label, makeError, status) => {
        const chat = await seedChatWithText(LONG_USER_TEXT)

        mocks.decide.mockRejectedValueOnce(makeError())
        mockOps([createOp()])

        const result = await run(chat)

        expect(result).toMatchObject({
          status: 'extracted',
          applied: { created: 1 },
        })
        expect(mocks.generateText).toHaveBeenCalledOnce()
        expect(loggedPrefilter().status).toBe(status)
        expect(loggedPrefilter().counts?.skipped).toBeUndefined()
        expect(JSON.stringify(loggerSet.mock.calls))
          .not.toContain('entriesAtScore')
      })

      it('runs the extraction when the answer lacks the question',
        async () => {
          const chat = await seedChatWithText(LONG_USER_TEXT)

          mocks.decide.mockResolvedValueOnce({ answers: {}, usage: {} })

          const result = await run(chat)

          expect(result.status).toBe('extracted')
          expect(loggedPrefilter().status).toBe('error')
        })

      it('leaves the failure counters alone when Jev fails', async () => {
        const chat = await seedChatWithText(LONG_USER_TEXT)

        mocks.decide.mockRejectedValueOnce(apiError(401))

        await run(chat)

        const stamped = await readChat(chat.id)

        expect(stamped?.memoryExtractionFailures).toBeNull()
        expect(stamped?.memoryExtractedAt).toEqual(minutesBefore(69))
      })
    })

    it('does not call Jev when the role is switched off', async () => {
      await testDb.db.update(schema.userSettings).set({
        typesafeRoles: { memoryChecks: false, extractionPrefilter: false },
      })

      const chat = await seedChatWithText(TASK_USER_TEXT)

      const result = await run(chat)

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(result.status).toBe('extracted')
    })
  })

  describe('without a TypeSafe AI key', () => {
    it('behaves exactly as before: no Jev call, no log, a full extraction',
      async () => {
        const chat = await seedChatWithText(TASK_USER_TEXT)

        mockOps([createOp({
          title: 'Early returns',
          description: 'Wants early returns',
          body: 'The user wants functions rewritten with early returns.',
          evidence: 'rewrite this function to use early returns',
        })])

        const result = await run(chat)

        expect(mocks.decide).not.toHaveBeenCalled()
        expect(result).toMatchObject({
          status: 'extracted',
          applied: { created: 1, updated: 0, deleted: 0 },
          usage: { inputTokens: 120, outputTokens: 30 },
        })
        expect(mocks.generateText).toHaveBeenCalledOnce()
        expect(JSON.stringify(loggerSet.mock.calls))
          .not.toContain('extractionPrefilterJev')
        expect((await readChat(chat.id))?.memoryExtractedAt)
          .toEqual(minutesBefore(69))
      })
  })
})

describe('splitMemoryExtractionTranscript', () => {
  const MAX_TOKENS = JEV_EXTRACTION_PREFILTER.maxChunkTokens

  function lines(text: string, count: number): string {
    return Array.from({ length: count }, (_value, index) => {
      return `User: ${text} ${index}`
    }).join('\n')
  }

  it('keeps a transcript under the cap in one piece', () => {
    const transcript = lines('I live in Lisbon', 10)

    expect(splitMemoryExtractionTranscript(transcript, MAX_TOKENS))
      .toEqual([transcript])
  })

  it('covers a long Latin transcript with pieces under the cap', () => {
    const transcript = lines('I write Rust and Go on weekends daily', 1200)
    const pieces = splitMemoryExtractionTranscript(transcript, MAX_TOKENS)

    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(transcript)

    for (const piece of pieces) {
      expect(estimateMemoryTokens(piece)).toBeLessThanOrEqual(MAX_TOKENS)
    }
  })

  it('splits Cyrillic text into more pieces than Latin text of the same '
    + 'length', () => {
    const latin = lines('I write Rust and Go on weekends daily', 1200)
    const cyrillic = lines('Я пишу код на Rust і Go щодня', 1200)
      .padEnd(latin.length, 'я')
    const cyrillicPieces = splitMemoryExtractionTranscript(
      cyrillic,
      MAX_TOKENS,
    )

    expect(cyrillicPieces.length).toBeGreaterThan(
      splitMemoryExtractionTranscript(latin, MAX_TOKENS).length,
    )
    expect(cyrillicPieces.join('')).toBe(cyrillic)

    for (const piece of cyrillicPieces) {
      expect(estimateMemoryTokens(piece)).toBeLessThanOrEqual(MAX_TOKENS)
    }
  })

  it('terminates on one unbroken run longer than the cap', () => {
    const transcript = 'x'.repeat(60_000)
    const pieces = splitMemoryExtractionTranscript(transcript, MAX_TOKENS)

    expect(pieces.join('')).toBe(transcript)

    for (const piece of pieces) {
      expect(estimateMemoryTokens(piece)).toBeLessThanOrEqual(MAX_TOKENS)
    }
  })
})
