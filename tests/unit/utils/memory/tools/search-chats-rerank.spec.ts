import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_RERANK } from '#shared/utils/jev-policy'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import { searchChats } from '~~/server/utils/memory/tools/search-chats'
import { normalizeSearchText } from '~~/server/utils/search/text'
import { buildStemmedSearchText } from '~~/server/utils/search/tokens'
import { createSearchIndexTestDb } from '../../../../setup/helpers/search-index-db'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

const WINNER_MARKER = 'winner'
const CARD_NUMBER = '4111 1111 1111 1111'

function testModel() {
  const model = createJevDecisionModel('ts-test-key')

  if (!model) {
    throw new Error('expected a model')
  }

  return model
}

function answerByPassage(
  scoreOf: (passage: string, index: number) => number,
) {
  mocks.decide.mockImplementation(async (options: {
    questions: Record<string, { instructions: { passage: string } }>
  }) => {
    return {
      answers: Object.fromEntries(
        Object.entries(options.questions).map(([id, question], index) => {
          return [id, {
            type: 'boolean',
            probability: scoreOf(question.instructions.passage, index),
          }]
        }),
      ),
      usage: { inputTokens: 100 },
    }
  })
}

describe('searchChats re-ranking with TypeSafe AI Jev', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>
  let nextMessageId = 1
  const resolveRerankModel = vi.fn(async () => testModel())

  function seedChatWithMessage(input: {
    id: number
    text: string
    userId?: number
  }): void {
    const userId = input.userId ?? 1
    const messageId = nextMessageId
    const body = normalizeSearchText(input.text)

    nextMessageId += 1
    testDb.insertChat({
      id: input.id,
      userId,
      slug: `slug-${input.id}`,
      title: `Chat ${input.id}`,
    })
    testDb.insertMessage({
      id: messageId,
      chatId: input.id,
      publicId: `01MESSAGE${String(messageId).padStart(17, '0')}`,
      role: 'user',
      createdAt: 1_700_000_000 + messageId,
    })
    testDb.sqlite.prepare(
      'insert into message_search(rowid, owner, body, body_stem)'
      + ' values (?, ?, ?, ?)',
    ).run(messageId, `u${userId}`, body, buildStemmedSearchText(body))
  }

  function search(input: {
    limit?: number
    withRerank?: boolean
    logger?: { set: (fields: Record<string, unknown>) => void }
  } = {}) {
    return searchChats({
      db: testDb.db,
      userId: 1,
      query: 'borscht',
      limit: input.limit,
      currentChatId: encodePublicId(9999),
      ...(input.withRerank === false ? {} : { resolveRerankModel }),
      logger: input.logger,
    })
  }

  function seedMany(count: number, markerChatId?: number): void {
    for (let chatId = 1; chatId <= count; chatId++) {
      seedChatWithMessage({
        id: chatId,
        text: chatId === markerChatId
          ? `borscht ${WINNER_MARKER} recipe number ${chatId}`
          : `borscht note ${chatId} ${'filler '.repeat(chatId)}`,
      })
    }
  }

  beforeEach(() => {
    nextMessageId = 1
    testDb = createSearchIndexTestDb()
    mocks.decide.mockReset()
    resolveRerankModel.mockClear()
    resolveRerankModel.mockImplementation(async () => testModel())
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns the BM25 order when no model is resolved', async () => {
    seedMany(6)

    const baseline = await search({ withRerank: false })

    resolveRerankModel.mockResolvedValue(null as any)

    const withoutKey = await search()

    expect(withoutKey).toEqual(baseline)
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('moves the most relevant chat to the top', async () => {
    seedMany(6, 6)

    const baseline = await search({ withRerank: false })

    answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.6)

    const reranked = await search()

    expect(baseline.results[0]!.chatId).not.toBe('slug-6')
    expect(reranked.results[0]!.chatId).toBe('slug-6')
    expect(reranked.results).toHaveLength(baseline.results.length)
  })

  it('never returns fewer results than the limit because of the cut',
    async () => {
      seedMany(8, 8)
      answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.1)

      const { results } = await search({ limit: 4 })

      expect(results).toHaveLength(4)
      expect(results[0]!.chatId).toBe('slug-8')
    })

  it('cuts irrelevant hits once enough relevant ones remain', async () => {
    seedMany(8)
    answerByPassage((_passage, index) => index < 5 ? 0.9 : 0.1)

    const { results } = await search({ limit: 3 })

    expect(results).toHaveLength(3)
  })

  it.each([
    ['a 401', apiError(401)],
    ['a timeout', Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    })],
  ])('keeps the BM25 order on %s', async (_label, failure) => {
    seedMany(6, 6)

    const baseline = await search({ withRerank: false })

    mocks.decide.mockRejectedValue(failure)

    expect(await search()).toEqual(baseline)
  })

  it('judges at most 30 candidates', async () => {
    seedMany(40)
    answerByPassage(() => 0.9)

    await search()

    const [options] = mocks.decide.mock.calls[0]!

    expect(Object.keys(options.questions)).toHaveLength(
      JEV_RERANK.maxCandidates,
    )
  })

  it('does not call Jev or resolve a model for a single hit', async () => {
    seedMany(1)

    const { results } = await search()

    expect(results).toHaveLength(1)
    expect(resolveRerankModel).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('sends the query as state and passages with no highlight markers or '
    + 'card numbers', async () => {
    seedChatWithMessage({
      id: 1,
      text: `borscht order paid with card ${CARD_NUMBER} yesterday`,
    })
    seedChatWithMessage({ id: 2, text: 'borscht with garlic buns' })
    answerByPassage(() => 0.9)

    await search()

    const [options] = mocks.decide.mock.calls[0]!
    const serialized = JSON.stringify(options)

    expect(options.state).toEqual({ query: 'borscht' })
    expect(serialized).not.toContain(SNIPPET_START)
    expect(serialized).not.toContain(SNIPPET_END)
    expect(serialized).not.toMatch(/4111|1111/)
    expect(serialized).toContain('borscht')
  })

  it('logs the rerank outcome without chat text', async () => {
    seedMany(6, 6)

    const fields: Array<Record<string, any>> = []

    answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.6)

    await search({
      logger: { set: value => fields.push(value) },
    })

    const rerankLog = fields
      .map(entry => entry.attributes?.rerankJev)
      .find(Boolean)

    expect(rerankLog).toMatchObject({
      status: 'ok',
      calls: 1,
      questions: 6,
      counts: { candidates: 6 },
    })
    expect(JSON.stringify(fields)).not.toContain('recipe number')
  })
})

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}
