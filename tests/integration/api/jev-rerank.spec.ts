import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgePackLine } from '#shared/types/project-knowledge.d'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createJevRerankModelResolver } from '~~/server/utils/jev/rerank'
import { createKnowledgeSearcher } from '~~/server/utils/knowledge/search'
import {
  createKnowledgeBudget,
  getKnowledgeTools,
} from '~~/server/utils/knowledge/tools/index'
import { createChatSearchBudget } from '~~/server/utils/memory/tools/chat-search-budget'
import { getChatSearchTools } from '~~/server/utils/memory/tools'
import { normalizeSearchText } from '~~/server/utils/search/text'
import { buildStemmedSearchText } from '~~/server/utils/search/tokens'
import { createSearchIndexTestDb } from '../../setup/helpers/search-index-db'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: (value: string) => mocks.decrypt(value),
}))

const USER_ID = 1
const WINNER_MARKER = 'winner'
const CHAT_COUNT = 6
const toolOptions = { toolCallId: 'call-1', messages: [] }

type ToolExecute = (input: unknown, options: unknown) => Promise<any>

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function answerByPassage() {
  mocks.decide.mockImplementation(async (options: {
    questions: Record<string, { instructions: { passage: string } }>
  }) => {
    return {
      answers: Object.fromEntries(
        Object.entries(options.questions).map(([id, question]) => {
          const isWinner = question.instructions.passage
            .includes(WINNER_MARKER)

          return [id, {
            type: 'boolean',
            probability: isWinner ? 0.97 : 0.6,
          }]
        }),
      ),
      usage: { inputTokens: 100 },
    }
  })
}

function createLogger() {
  const fields: Array<Record<string, any>> = []
  let context: Record<string, any> = {}

  return {
    fields,
    logger: {
      set: (value: Record<string, any>) => {
        fields.push(value)
        context = {
          ...context,
          attributes: { ...context.attributes, ...value.attributes },
        }
      },
      getContext: () => context,
    },
    readRerank: () => context.attributes?.rerankJev as
      Record<string, any> | undefined,
  }
}

describe('TypeSafe AI re-ranking on the real tools', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>
  let keyRow: { apiKey: string } | undefined
  let rolesRow: Record<string, boolean> | null

  function seedChats(): void {
    for (let chatId = 1; chatId <= CHAT_COUNT; chatId++) {
      const body = normalizeSearchText(
        chatId === CHAT_COUNT
          ? `borscht ${WINNER_MARKER} ${'filler '.repeat(20)} recipe`
          : `borscht note ${chatId} ${'filler '.repeat(chatId)}`,
      )

      testDb.insertChat({
        id: chatId,
        userId: USER_ID,
        slug: `slug-${chatId}`,
        title: `Chat ${chatId}`,
      })
      testDb.insertMessage({
        id: chatId,
        chatId,
        publicId: `01MESSAGE${String(chatId).padStart(17, '0')}`,
        role: 'user',
        createdAt: 1_700_000_000 + chatId,
      })
      testDb.sqlite.prepare(
        'insert into message_search(rowid, owner, body, body_stem)'
        + ' values (?, ?, ?, ?)',
      ).run(chatId, `u${USER_ID}`, body, buildStemmedSearchText(body))
    }
  }

  function createResolverDb() {
    const keyFindFirst = vi.fn(async () => keyRow)
    const settingsFindFirst = vi.fn(async () => {
      return rolesRow === null ? undefined : { typesafeRoles: rolesRow }
    })

    return {
      keyFindFirst,
      db: {
        query: {
          keys: { findFirst: keyFindFirst },
          userSettings: { findFirst: settingsFindFirst },
        },
      } as any,
    }
  }

  function chatSearchExecute(input: {
    withRerank: boolean
    logger?: ReturnType<typeof createLogger>['logger']
    resolverDb?: ReturnType<typeof createResolverDb>['db']
  }): ToolExecute {
    const resolverDb = input.resolverDb ?? createResolverDb().db
    const { tools } = getChatSearchTools({
      db: testDb.db,
      userId: USER_ID,
      currentChatId: encodePublicId(9999),
      budget: createChatSearchBudget(),
      ...(input.withRerank
        ? {
          resolveRerankModel: createJevRerankModelResolver({
            db: resolverDb,
            userId: USER_ID,
            logger: input.logger,
          }),
        }
        : {}),
      logger: input.logger,
    })

    return (tools.search_chats as any).execute
  }

  function knowledgeSearchExecute(input: {
    logger?: ReturnType<typeof createLogger>['logger']
  }): ToolExecute {
    const lines = Array.from({ length: 12 }, (_, index): KnowledgePackLine => {
      return {
        type: 'chunk',
        itemId: 'item-a',
        ordinal: index,
        breadcrumb: 'Handbook > Deploy',
        text: index === 11
          ? `Deploy ${WINNER_MARKER} section`
          : `Deploy section ${index} ${'filler '.repeat(index)}`,
      }
    })
    const searcher = createKnowledgeSearcher({
      lines,
      items: [{
        id: 'item-a',
        title: 'Handbook',
        relativePath: 'docs/handbook.md',
      }],
    })
    const { tools } = getKnowledgeTools({
      getSearcher: async () => searcher,
      budget: createKnowledgeBudget(),
      resolveRerankModel: createJevRerankModelResolver({
        db: createResolverDb().db,
        userId: USER_ID,
        logger: input.logger,
      }),
    })

    return (tools.search_project_knowledge as any).execute
  }

  function chatIds(output: { results: Array<{ chatId: string }> }) {
    return output.results.map(result => result.chatId)
  }

  beforeEach(() => {
    testDb = createSearchIndexTestDb()
    seedChats()
    keyRow = undefined
    rolesRow = null
    mocks.decide.mockReset()
    mocks.decrypt.mockReset().mockImplementation(async (value: string) => {
      return value
    })
  })

  afterEach(() => {
    testDb.close()
  })

  describe('without a TypeSafe AI key', () => {
    it('returns the same search_chats result and never calls Jev', async () => {
      const baseline = await chatSearchExecute({ withRerank: false })(
        { query: 'borscht' },
        toolOptions,
      )
      const { logger, fields } = createLogger()
      const { db, keyFindFirst } = createResolverDb()
      const withResolver = await chatSearchExecute({
        withRerank: true,
        logger,
        resolverDb: db,
      })({ query: 'borscht' }, toolOptions)

      expect(withResolver).toEqual(baseline)
      expect(keyFindFirst).toHaveBeenCalledTimes(1)
      expect(mocks.decide).not.toHaveBeenCalled()
      expect(JSON.stringify(fields)).not.toContain('rerankJev')
    })

    it('returns the BM25 search_project_knowledge result', async () => {
      const first = await knowledgeSearchExecute({})(
        { query: 'deploy' },
        toolOptions,
      )

      expect(first.hits).toHaveLength(6)
      expect(first.hits.map((hit: any) => hit.ordinal)).not.toContain(11)
      expect(mocks.decide).not.toHaveBeenCalled()
    })
  })

  describe('with a TypeSafe AI key', () => {
    beforeEach(() => {
      keyRow = { apiKey: 'encrypted-ts-key' }
    })

    it('re-orders search_chats results', async () => {
      const baseline = await chatSearchExecute({ withRerank: false })(
        { query: 'borscht' },
        toolOptions,
      )

      answerByPassage()

      const { logger, readRerank } = createLogger()
      const output = await chatSearchExecute({ withRerank: true, logger })(
        { query: 'borscht' },
        toolOptions,
      )

      expect(chatIds(baseline)[0]).not.toBe(`slug-${CHAT_COUNT}`)
      expect(chatIds(output)[0]).toBe(`slug-${CHAT_COUNT}`)
      expect(output.results).toHaveLength(baseline.results.length)
      expect(readRerank()).toMatchObject({ status: 'ok', calls: 1 })
    })

    it('re-orders search_project_knowledge hits', async () => {
      answerByPassage()

      const output = await knowledgeSearchExecute({})(
        { query: 'deploy' },
        toolOptions,
      )

      expect(output.hits[0].ordinal).toBe(11)
    })

    it('skips Jev when the rerank role is switched off', async () => {
      rolesRow = { rerank: false }

      const baseline = await chatSearchExecute({ withRerank: false })(
        { query: 'borscht' },
        toolOptions,
      )
      const output = await chatSearchExecute({ withRerank: true })(
        { query: 'borscht' },
        toolOptions,
      )

      expect(output).toEqual(baseline)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it.each([
      ['unauthorized', apiError(401)],
      ['rate-limited', apiError(529)],
      ['timeout', Object.assign(new Error('timed out'), {
        name: 'TimeoutError',
      })],
    ])('keeps the BM25 order on %s', async (status, failure) => {
      const baseline = await chatSearchExecute({ withRerank: false })(
        { query: 'borscht' },
        toolOptions,
      )

      mocks.decide.mockRejectedValue(failure)

      const { logger, readRerank } = createLogger()
      const output = await chatSearchExecute({ withRerank: true, logger })(
        { query: 'borscht' },
        toolOptions,
      )

      expect(output).toEqual(baseline)
      expect(readRerank()).toMatchObject({ status })
    })

    it('keeps the original knowledge order on a 401', async () => {
      const baseline = await knowledgeSearchExecute({})(
        { query: 'deploy' },
        toolOptions,
      )

      mocks.decide.mockRejectedValue(apiError(401))

      const output = await knowledgeSearchExecute({})(
        { query: 'deploy' },
        toolOptions,
      )

      expect(output.hits.map((hit: any) => hit.ordinal))
        .toEqual(baseline.hits.map((hit: any) => hit.ordinal))
    })

    it('keeps the BM25 order and logs key-error when decryption fails',
      async () => {
        mocks.decrypt.mockRejectedValue(new Error('bad ciphertext'))

        const baseline = await chatSearchExecute({ withRerank: false })(
          { query: 'borscht' },
          toolOptions,
        )
        const { logger, readRerank } = createLogger()
        const output = await chatSearchExecute({ withRerank: true, logger })(
          { query: 'borscht' },
          toolOptions,
        )

        expect(output).toEqual(baseline)
        expect(readRerank()).toMatchObject({ status: 'key-error' })
        expect(mocks.decide).not.toHaveBeenCalled()
      })
  })
})
