import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgePackLine } from '#shared/types/project-knowledge.d'
import { JEV_RERANK } from '#shared/utils/jev-policy'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import { buildKnowledgeExcerpts } from '~~/server/utils/knowledge/pre-retrieval'
import { searchKnowledgeWithRerank } from '~~/server/utils/knowledge/rerank'
import { createKnowledgeSearcher } from '~~/server/utils/knowledge/search'
import {
  createKnowledgeBudget,
  getKnowledgeTools,
} from '~~/server/utils/knowledge/tools/index'

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

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function answerByPassage(
  scoreOf: (passage: string, index: number) => number,
) {
  mocks.decide.mockImplementation(async (options: {
    state: Record<string, string>
    questions: Record<string, unknown>
  }) => {
    return {
      answers: Object.fromEntries(
        Object.keys(options.questions).map((id, index) => {
          return [id, {
            type: 'boolean',
            probability: scoreOf(options.state[`passage_${index}`]!, index),
          }]
        }),
      ),
      usage: { inputTokens: 100 },
    }
  })
}

function chunk(ordinal: number, text: string): KnowledgePackLine {
  return {
    type: 'chunk',
    itemId: 'item-a',
    ordinal,
    breadcrumb: 'Handbook > Deploy',
    text,
  }
}

function createSearcher(chunkCount: number, winnerOrdinal?: number) {
  const lines = Array.from({ length: chunkCount }, (_, ordinal) => {
    return chunk(
      ordinal,
      ordinal === winnerOrdinal
        ? `Deploy ${WINNER_MARKER} section number ${ordinal}`
        : `Deploy section number ${ordinal} ${'filler '.repeat(ordinal)}`,
    )
  })

  return createKnowledgeSearcher({
    lines,
    items: [
      { id: 'item-a', title: 'Handbook', relativePath: 'docs/handbook.md' },
    ],
  })
}

const resolveRerankModel = vi.fn(async () => testModel() as any)

beforeEach(() => {
  mocks.decide.mockReset()
  resolveRerankModel.mockReset().mockImplementation(async () => testModel())
})

describe('searcher candidates and caps', () => {
  it('composes search() from searchCandidates() and capHits()', () => {
    const searcher = createSearcher(10)
    const candidates = searcher.searchCandidates({ query: 'deploy' })

    expect(searcher.capHits(candidates.hits, candidates.operator))
      .toEqual(searcher.search({ query: 'deploy' }))
  })

  it('returns at most the candidate limit before the caps apply', () => {
    const searcher = createSearcher(45)
    const candidates = searcher.searchCandidates({ query: 'deploy' })

    expect(candidates.hits).toHaveLength(JEV_RERANK.maxCandidates)
    expect(searcher.capHits(candidates.hits, candidates.operator).hits)
      .toHaveLength(KNOWLEDGE_LIMITS.searchMaxChunks)
  })

  it('reports no candidates for a query with nothing to search', () => {
    expect(createSearcher(3).searchCandidates({ query: '   ' })).toEqual({
      hits: [],
      operator: 'none',
    })
  })
})

describe('searchKnowledgeWithRerank', () => {
  function rerankSearch(
    searcher = createSearcher(12, 11),
    keepAtLeast: number = KNOWLEDGE_LIMITS.searchMaxChunks,
  ) {
    return searchKnowledgeWithRerank({
      searcher,
      search: { query: 'deploy' },
      keepAtLeast,
      resolveRerankModel,
    })
  }

  it('is exactly search() without a resolver', async () => {
    const searcher = createSearcher(12, 11)

    expect(await searchKnowledgeWithRerank({
      searcher,
      search: { query: 'deploy' },
      keepAtLeast: KNOWLEDGE_LIMITS.searchMaxChunks,
    })).toEqual(searcher.search({ query: 'deploy' }))
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('is exactly search() when the resolver finds no model', async () => {
    const searcher = createSearcher(12, 11)

    resolveRerankModel.mockResolvedValue(null)

    expect(await rerankSearch(searcher))
      .toEqual(searcher.search({ query: 'deploy' }))
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('re-ranks the candidates before the chunk cap', async () => {
    const searcher = createSearcher(12, 11)
    const baseline = searcher.search({ query: 'deploy' })

    answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.6)

    const result = await rerankSearch(searcher)

    expect(baseline.hits.map(hit => hit.ordinal)).not.toContain(11)
    expect(result.hits[0]!.ordinal).toBe(11)
    expect(result.hits).toHaveLength(KNOWLEDGE_LIMITS.searchMaxChunks)
    expect(result.operator).toBe(baseline.operator)
  })

  it('never returns fewer hits than the chunk limit because of the cut',
    async () => {
      answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.1)

      const result = await rerankSearch()

      expect(result.hits).toHaveLength(KNOWLEDGE_LIMITS.searchMaxChunks)
      expect(result.hits[0]!.ordinal).toBe(11)
    })

  it.each([
    ['a 401', apiError(401)],
    ['a timeout', Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    })],
  ])('keeps the original order on %s', async (_label, failure) => {
    const searcher = createSearcher(12, 11)

    mocks.decide.mockRejectedValue(failure)

    expect(await rerankSearch(searcher))
      .toEqual(searcher.search({ query: 'deploy' }))
  })

  it('judges at most 30 candidates', async () => {
    answerByPassage(() => 0.9)

    await rerankSearch(createSearcher(45))

    const [options] = mocks.decide.mock.calls[0]!

    expect(Object.keys(options.questions)).toHaveLength(
      JEV_RERANK.maxCandidates,
    )
  })

  it('does not resolve a model for a single candidate', async () => {
    const searcher = createSearcher(1)

    expect(await rerankSearch(searcher))
      .toEqual(searcher.search({ query: 'deploy' }))
    expect(resolveRerankModel).not.toHaveBeenCalled()
  })

  it('sends passages with the breadcrumb, redacted of card numbers',
    async () => {
      const searcher = createKnowledgeSearcher({
        lines: [
          chunk(0, `Deploy checklist, pay with ${CARD_NUMBER} first`),
          chunk(1, 'Deploy rollback steps'),
        ],
        items: [{
          id: 'item-a',
          title: 'Handbook',
          relativePath: 'docs/handbook.md',
        }],
      })

      answerByPassage(() => 0.9)

      await rerankSearch(searcher)

      const [options] = mocks.decide.mock.calls[0]!
      const serialized = JSON.stringify(options)

      expect(serialized).not.toMatch(/4111|1111/)
      expect(options.state.passage_0).toContain('Handbook > Deploy')
      expect(options.state.query).toBe('deploy')
    })
})

describe('search_project_knowledge re-ranking', () => {
  const toolOptions = { toolCallId: 'call-1', messages: [] }

  function searchTool(input: { withRerank: boolean }) {
    const searcher = createSearcher(12, 11)
    const { tools } = getKnowledgeTools({
      getSearcher: async () => searcher,
      budget: createKnowledgeBudget(),
      ...(input.withRerank ? { resolveRerankModel } : {}),
    })

    return (tools.search_project_knowledge as any).execute as (
      toolInput: unknown,
      options: unknown,
    ) => Promise<{ hits: Array<{ ordinal: number }> }>
  }

  it('re-orders hits when a rerank model is available', async () => {
    answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.6)

    const result = await searchTool({ withRerank: true })(
      { query: 'deploy' },
      toolOptions,
    )

    expect(result.hits[0]!.ordinal).toBe(11)
  })

  it('returns identical hits without a rerank resolver', async () => {
    const result = await searchTool({ withRerank: false })(
      { query: 'deploy' },
      toolOptions,
    )
    const baseline = createSearcher(12, 11).search({ query: 'deploy' })

    expect(result.hits.map(hit => hit.ordinal))
      .toEqual(baseline.hits.map(hit => hit.ordinal))
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('keeps the original order when Jev fails', async () => {
    mocks.decide.mockRejectedValue(apiError(401))

    const result = await searchTool({ withRerank: true })(
      { query: 'deploy' },
      toolOptions,
    )
    const baseline = createSearcher(12, 11).search({ query: 'deploy' })

    expect(result.hits.map(hit => hit.ordinal))
      .toEqual(baseline.hits.map(hit => hit.ordinal))
  })
})

describe('buildKnowledgeExcerpts with re-ranked hits', () => {
  it('quotes the supplied hits in their order and honours the caps',
    async () => {
      const searcher = createSearcher(12, 11)

      answerByPassage(passage => passage.includes(WINNER_MARKER) ? 0.97 : 0.6)

      const { hits } = await searchKnowledgeWithRerank({
        searcher,
        search: { query: 'deploy', strict: true },
        keepAtLeast: KNOWLEDGE_LIMITS.preRetrievalMaxChunks,
        resolveRerankModel,
      })
      const excerpts = buildKnowledgeExcerpts({
        searcher,
        userText: 'deploy',
        hits,
      })

      expect(excerpts).not.toBeNull()
      expect(excerpts!.indexOf(WINNER_MARKER)).toBeGreaterThan(-1)
      expect(excerpts!.match(/<knowledge_excerpt/g) ?? [])
        .toHaveLength(KNOWLEDGE_LIMITS.preRetrievalMaxChunks)
    })

  it('falls back to its own strict search without hits', () => {
    const searcher = createSearcher(12, 11)

    expect(buildKnowledgeExcerpts({ searcher, userText: 'deploy' }))
      .toBe(buildKnowledgeExcerpts({
        searcher,
        userText: 'deploy',
        hits: searcher.search({ query: 'deploy', strict: true }).hits,
      }))
  })

  it('returns null for an empty hit list instead of searching again',
    () => {
      const searcher = createSearcher(12, 11)

      expect(buildKnowledgeExcerpts({
        searcher,
        userText: 'deploy',
        hits: [],
      })).toBeNull()
    })
})
