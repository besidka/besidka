import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '../../../../server/utils/ai/tool-loop'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

const BRAVE_SEARCH_RESPONSE = {
  grounding: {
    generic: [
      {
        url: 'https://www.besidka.com/',
        title: 'Besidka — AI Chat',
        snippets: [
          'Bring your own API key and pay for what you use.',
          '- Supports Anthropic, Google and OpenAI.\n- No subscription.',
        ],
      },
      {
        url: 'https://example.com/no-title',
        snippets: ['A result with no title at all.'],
      },
      {
        url: 'https://example.com/source-title',
        snippets: ['Title comes from source metadata.'],
      },
    ],
    map: [],
  },
  sources: {
    'https://www.besidka.com/': {
      title: 'Besidka — AI Chat',
      hostname: 'www.besidka.com',
      age: [
        'Tuesday, October 21, 2025',
        '2025-10-21',
        '348 days ago',
        '2025-10-21T07:25:05Z',
      ],
      site_name: 'Besidka',
    },
    'https://example.com/no-title': {
      hostname: 'example.com',
      age: null,
    },
    'https://example.com/source-title': {
      title: 'Source metadata title',
      hostname: 'example.com',
      age: ['not a date', 'garbage', '1 day ago', null],
    },
  },
}

function jsonResponse(
  body: unknown,
  init: { ok?: boolean, status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }
}

function createExecutionOptions(abortSignal?: AbortSignal) {
  return {
    toolCallId: 'call-1',
    messages: [],
    context: undefined,
    abortSignal,
  }
}

async function importModule() {
  return await import('../../../../server/utils/search/brave')
}

describe('getBraveWebSearchTools tool shape', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('marks the tool with the follow-up-turn loop marker and sets no '
    + 'forced toolChoice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')

    expect(toolRequiresFollowUpTurn(result.tools?.web_search_brave))
      .toBe(true)
    expect(result.toolChoice).toBeUndefined()
  })

  it('registers the tool under web_search_brave, distinct from every '
    + 'native web_search* key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')

    expect(result.tools).toHaveProperty('web_search_brave')
    expect(result.tools).not.toHaveProperty('web_search')
    expect(result.tools).not.toHaveProperty('web_search_preview')
  })
})

describe('web_search_brave tool execute()', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('requests Brave\'s LLM Context endpoint with the fixed params and the '
    + 'X-Subscription-Token header, never Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await searchTool.execute(
      { query: 'python web frameworks' },
      createExecutionOptions(),
    )

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]

    expect(url.origin + url.pathname).toBe(
      'https://api.search.brave.com/res/v1/llm/context',
    )
    expect(url.searchParams.get('q')).toBe('python web frameworks')
    expect(url.searchParams.get('count')).toBe('8')
    expect(url.searchParams.get('maximum_number_of_tokens')).toBe('3072')
    expect(url.searchParams.get('maximum_number_of_tokens_per_url'))
      .toBe('1024')
    expect(url.searchParams.get('enable_source_metadata')).toBe('true')
    expect(url.searchParams.has('freshness')).toBe(false)
    expect(url.searchParams.has('result_filter')).toBe(false)
    expect(init.headers).toMatchObject({
      'X-Subscription-Token': 'brave-key',
    })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('maps each freshness value to Brave\'s freshness code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave
    const expectedCodes = {
      day: 'pd',
      week: 'pw',
      month: 'pm',
      year: 'py',
    }

    for (const [freshness, code] of Object.entries(expectedCodes)) {
      await searchTool.execute(
        { query: 'news', freshness },
        createExecutionOptions(),
      )

      const [url] = fetchMock.mock.calls.at(-1) as [URL]

      expect(url.searchParams.get('freshness')).toBe(code)
    }
  })

  it('accepts an optional freshness enum and rejects other values',
    async () => {
      vi.stubGlobal('fetch', vi.fn())

      const { getBraveWebSearchTools } = await importModule()
      const result = await getBraveWebSearchTools('brave-key')
      const schema = result.tools?.web_search_brave.inputSchema

      expect(schema.safeParse({ query: 'x' }).success).toBe(true)
      expect(schema.safeParse({ query: 'x', freshness: 'week' }).success)
        .toBe(true)
      expect(schema.safeParse({ query: 'x', freshness: 'decade' }).success)
        .toBe(false)
    })

  it('normalizes grounding.generic[] to { title, url, snippet, '
    + 'publishedDate } with snippets joined by newlines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output.provider).toBe('brave')
    expect(output.results).toHaveLength(3)
    expect(output.results[0]).toEqual({
      title: 'Besidka — AI Chat',
      url: 'https://www.besidka.com/',
      snippet: 'Bring your own API key and pay for what you use.\n'
        + '- Supports Anthropic, Google and OpenAI.\n- No subscription.',
      publishedDate: '2025-10-21T07:25:05Z',
    })
  })

  it('prefers the full timestamp age[3], falls back to age[1], and '
    + 'accepts only ISO values', async () => {
    const ageCases: Array<[Array<string | null> | null, string | undefined]> = [
      [['x', '2025-10-21', 'y', '2025-10-21T07:25:05Z'], '2025-10-21T07:25:05Z'],
      [['x', '2025-10-21', 'y', null], '2025-10-21'],
      [['x', '2025-10-21', 'y', 'October 21, 2025'], '2025-10-21'],
      [['x', 'October 21, 2025', 'y', '2025-10-21T07:25:05.123+02:00'],
        '2025-10-21T07:25:05.123+02:00'],
      [['x', 'October 21, 2025', 'y', 'yesterday'], undefined],
      [['x', '2025-10-21; DROP', 'y', null], undefined],
      [['x', '2025-10-21'], '2025-10-21'],
      [null, undefined],
    ]
    const { getBraveWebSearchTools } = await importModule()

    for (const [age, expectedDate] of ageCases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        grounding: {
          generic: [{ url: 'https://dated.example/', snippets: ['S'] }],
        },
        sources: { 'https://dated.example/': { hostname: 'dated.example', age } },
      })))

      const result = await getBraveWebSearchTools('brave-key')
      const output = await result.tools?.web_search_brave.execute(
        { query: 'dated' },
        createExecutionOptions(),
      )

      expect(output.results[0].publishedDate).toBe(expectedDate)
    }
  })

  it('falls back to the source hostname when Brave omits a title and has '
    + 'no source title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output.results[1]).toEqual({
      title: 'example.com',
      url: 'https://example.com/no-title',
      snippet: 'A result with no title at all.',
    })
  })

  it('falls back to the source metadata title and drops an invalid age '
    + 'date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output.results[2]).toEqual({
      title: 'Source metadata title',
      url: 'https://example.com/source-title',
      snippet: 'Title comes from source metadata.',
    })
  })

  it('falls back to the URL hostname when there is no source entry at all',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        jsonResponse({
          grounding: {
            generic: [{
              url: 'https://orphan.example.org/page',
              snippets: ['Orphan.'],
            }],
          },
        }),
      ))

      const { getBraveWebSearchTools } = await importModule()
      const result = await getBraveWebSearchTools('brave-key')
      const searchTool = result.tools?.web_search_brave

      const output = await searchTool.execute(
        { query: 'besidka' },
        createExecutionOptions(),
      )

      expect(output.results[0].title).toBe('orphan.example.org')
    })

  it('returns an empty result list when grounding.generic is empty or '
    + 'missing', async () => {
    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    for (const body of [{ grounding: { generic: [] } }, {}]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))

      const output = await searchTool.execute(
        { query: 'besidka' },
        createExecutionOptions(),
      )

      expect(output.results).toEqual([])
    }
  })

  it('never surfaces a costDollars field, since Brave reports no cost',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        jsonResponse(BRAVE_SEARCH_RESPONSE),
      ))

      const { getBraveWebSearchTools } = await importModule()
      const result = await getBraveWebSearchTools('brave-key')
      const searchTool = result.tools?.web_search_brave

      const output = await searchTool.execute(
        { query: 'besidka' },
        createExecutionOptions(),
      )

      expect(output).not.toHaveProperty('costDollars')
    })

  it('propagates the AI SDK abort signal into the fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave
    const controller = new AbortController()

    await searchTool.execute(
      { query: 'x' },
      createExecutionOptions(controller.signal),
    )

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]

    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal?.aborted).toBe(false)

    controller.abort()

    expect(init.signal?.aborted).toBe(true)
  })

  it('still applies its own timeout signal when no AI SDK abort signal is '
    + 'given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(BRAVE_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await searchTool.execute({ query: 'x' }, createExecutionOptions())

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]

    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws a transient error when Brave responds with a 5xx status',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        jsonResponse({}, { ok: false, status: 500 }),
      ))

      const { getBraveWebSearchTools } = await importModule()
      const result = await getBraveWebSearchTools('brave-key')
      const searchTool = result.tools?.web_search_brave

      await expect(searchTool.execute(
        { query: 'x' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'Brave Search is temporarily unavailable.',
        status: 500,
      })
    })

  it.each([400, 422])('reports an invalid search request on a %i, not a '
    + 'transient outage', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status }),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search rejected the search request as invalid.',
      status,
    })
  })

  it('tells the caller to update the key on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 401 }),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search rejected the saved API key.',
      status: 401,
      fix: 'Update the key in Profile > Keys, then try again.',
    })
  })

  it('tells the caller to update the key on a 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 403 }),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search rejected the saved API key.',
      status: 403,
    })
  })

  it('reports quota/rate limiting distinctly on a 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 429 }),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search is rate limited or out of quota.',
      status: 429,
    })
  })

  it('reports quota/rate limiting distinctly on a 402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 402 }),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search is rate limited or out of quota.',
      status: 402,
    })
  })

  it('turns an AbortSignal.timeout() rejection into a readable transient '
    + 'error instead of an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    ))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Brave Search is temporarily unavailable.',
      status: 504,
      why: 'Brave Search\'s search request timed out.',
    })
  })

  it('rethrows a genuine caller abort untouched', async () => {
    const abortException = new DOMException('The user aborted.', 'AbortError')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortException))

    const { getBraveWebSearchTools } = await importModule()
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toBe(abortException)
  })
})

describe('web_search_brave per-request search budget', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('rejects the 9th call without calling Brave', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return jsonResponse(BRAVE_SEARCH_RESPONSE)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { getBraveWebSearchTools } = await importModule()
    const { EXTERNAL_SEARCH_LIMIT_MESSAGE } = await import(
      '../../../../server/utils/search/search-budget'
    )
    const result = await getBraveWebSearchTools('brave-key')
    const searchTool = result.tools?.web_search_brave
    const outcomes = await Promise.allSettled(
      Array.from({ length: 9 }, () => {
        return searchTool.execute(
          { query: 'many' },
          createExecutionOptions(),
        )
      }),
    )
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected')

    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: { message: EXTERNAL_SEARCH_LIMIT_MESSAGE },
    })
  })

  it('shares one budget across tool sets built from the same budget',
    async () => {
      const fetchMock = vi.fn().mockImplementation(async () => {
        return jsonResponse(BRAVE_SEARCH_RESPONSE)
      })

      vi.stubGlobal('fetch', fetchMock)

      const { getBraveWebSearchTools } = await importModule()
      const { createExternalSearchBudget } = await import(
        '../../../../server/utils/search/search-budget'
      )
      const searchBudget = createExternalSearchBudget(1)
      const first = await getBraveWebSearchTools('brave-key', searchBudget)
      const second = await getBraveWebSearchTools('brave-key', searchBudget)

      await first.tools?.web_search_brave.execute(
        { query: 'one' },
        createExecutionOptions(),
      )

      await expect(second.tools?.web_search_brave.execute(
        { query: 'two' },
        createExecutionOptions(),
      )).rejects.toMatchObject({ status: 429 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  it('does not share a budget between separately built tool sets',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        jsonResponse(BRAVE_SEARCH_RESPONSE),
      ))

      const { getBraveWebSearchTools } = await importModule()
      const { EXTERNAL_SEARCH_MAX_CALLS_PER_TURN } = await import(
        '../../../../server/utils/search/search-budget'
      )

      async function spendFreshBudget() {
        const result = await getBraveWebSearchTools('brave-key')

        for (let call = 0; call < EXTERNAL_SEARCH_MAX_CALLS_PER_TURN; call++) {
          await result.tools?.web_search_brave.execute(
            { query: 'q' },
            createExecutionOptions(),
          )
        }
      }

      await expect(spendFreshBudget()).resolves.toBeUndefined()
      await expect(spendFreshBudget()).resolves.toBeUndefined()
    })
})
