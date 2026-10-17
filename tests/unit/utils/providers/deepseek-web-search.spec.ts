import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '../../../../server/utils/ai/tool-loop'
import { createExternalSearchBudget } from '../../../../server/utils/search/search-budget'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

const SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'

const API_RESULT = {
  rerank_score: 0.91,
  title: 'Nuxt 4 released',
  url: 'https://nuxt.com/blog/v4',
  snippet: 'Short snippet',
  summary: 'Longer summary for the model',
  content: 'Full content that must be dropped',
  site_name: 'Nuxt',
  site_icon: 'https://nuxt.com/icon.png',
  date: '2026-07-01',
  authority: 0.8,
}

function jsonResponse(
  body: unknown,
  init: { ok?: boolean, status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
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
  return await import(
    '../../../../server/utils/providers/deepseek-web-search'
  )
}

async function getWebSearchTool(
  budget = createExternalSearchBudget(),
  logger?: { set: ReturnType<typeof vi.fn> },
) {
  const { getDeepSeekWebSearchTools } = await importModule()
  const { tools } = getDeepSeekWebSearchTools('deepseek-key', budget, logger)
  const webSearch = tools?.web_search as {
    inputSchema: {
      safeParse: (value: unknown) => { success: boolean }
    }
    execute: (input: unknown, options: unknown) => Promise<unknown>
  }

  return webSearch
}

describe('getDeepSeekWebSearchTools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('registers a single follow-up-turn tool named web_search', async () => {
    const { getDeepSeekWebSearchTools } = await importModule()
    const { tools, toolChoice } = getDeepSeekWebSearchTools('deepseek-key')

    expect(Object.keys(tools ?? {})).toEqual(['web_search'])
    expect(toolRequiresFollowUpTurn(tools?.web_search)).toBe(true)
    expect(toolChoice).toBeUndefined()
  })

  it('accepts queries of 1 to 128 characters only', async () => {
    const webSearch = await getWebSearchTool()

    expect(webSearch.inputSchema.safeParse({ query: 'a' }).success)
      .toBe(true)
    expect(webSearch.inputSchema.safeParse({
      query: 'a'.repeat(128),
    }).success).toBe(true)
    expect(webSearch.inputSchema.safeParse({ query: '' }).success)
      .toBe(false)
    expect(webSearch.inputSchema.safeParse({
      query: 'a'.repeat(129),
    }).success).toBe(false)
  })

  it('posts the query with the user key and a fixed request shape',
    async () => {
      const fetchMock = vi.fn(async () => {
        return jsonResponse({ results: [API_RESULT] })
      })

      vi.stubGlobal('fetch', fetchMock)

      const webSearch = await getWebSearchTool()

      await webSearch.execute(
        { query: 'nuxt 4 site:nuxt.com' },
        createExecutionOptions(),
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]

      expect(url).toBe(SEARCH_URL)
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('manual')
      expect(init.headers).toEqual({
        'authorization': 'Bearer deepseek-key',
        'content-type': 'application/json',
      })
      expect(JSON.parse(init.body as string)).toEqual({
        query: 'nuxt 4 site:nuxt.com',
        count: 8,
        need_content: false,
      })
    })

  it('maps results compactly and marks a non-empty response billable',
    async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        return jsonResponse({ results: [API_RESULT] })
      }))

      const webSearch = await getWebSearchTool()
      const output = await webSearch.execute(
        { query: 'nuxt 4' },
        createExecutionOptions(),
      )

      expect(output).toEqual({
        provider: 'deepseek',
        query: 'nuxt 4',
        billable: true,
        results: [{
          title: 'Nuxt 4 released',
          url: 'https://nuxt.com/blog/v4',
          snippet: 'Short snippet',
          summary: 'Longer summary for the model',
          siteName: 'Nuxt',
          date: '2026-07-01',
        }],
      })
      expect(JSON.stringify(output)).not.toMatch(/\$|cost/i)
    })

  it('omits nullable site name and date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return jsonResponse({
        results: [{
          ...API_RESULT,
          site_name: null,
          site_icon: null,
          date: null,
        }],
      })
    }))

    const webSearch = await getWebSearchTool()
    const output = await webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    ) as { results: Array<Record<string, unknown>> }

    expect(output.results[0]).not.toHaveProperty('siteName')
    expect(output.results[0]).not.toHaveProperty('date')
  })

  it('returns a non-billable output for an empty or missing results array',
    async () => {
      const responses = [{ results: [] }, {}, { results: null }]

      for (const body of responses) {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)))

        const webSearch = await getWebSearchTool()
        const output = await webSearch.execute(
          { query: 'nothing' },
          createExecutionOptions(),
        )

        expect(output).toEqual({
          provider: 'deepseek',
          query: 'nothing',
          billable: false,
          results: [],
        })
      }
    })

  it('records the result count on the logger', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return jsonResponse({ results: [API_RESULT, API_RESULT] })
    }))

    const logger = { set: vi.fn() }
    const webSearch = await getWebSearchTool(
      createExternalSearchBudget(),
      logger,
    )

    await webSearch.execute({ query: 'nuxt 4' }, createExecutionOptions())

    expect(logger.set).toHaveBeenCalledWith({
      attributes: { deepseekWebSearch: { resultCount: 2 } },
    })
  })

  it('throws a status error for a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return jsonResponse(
        { error: { message: 'insufficient balance' } },
        { ok: false, status: 402 },
      )
    }))

    const webSearch = await getWebSearchTool()

    await expect(webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'DeepSeek is rate limited or out of quota.',
      status: 402,
    })
  })

  it('throws a key error for a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return jsonResponse({}, { ok: false, status: 401 })
    }))

    const webSearch = await getWebSearchTool()

    await expect(webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'DeepSeek rejected the saved API key.',
      status: 401,
    })
  })

  it('throws a temporary-unavailable error for a network failure',
    async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('network down')
      }))

      const webSearch = await getWebSearchTool()

      await expect(webSearch.execute(
        { query: 'nuxt 4' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'DeepSeek is temporarily unavailable.',
        status: 504,
      })
    })

  it('rethrows a caller abort untouched', async () => {
    const abortError = new DOMException('aborted', 'AbortError')

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abortError
    }))

    const webSearch = await getWebSearchTool()

    await expect(webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(new AbortController().signal),
    )).rejects.toBe(abortError)
  })

  it('throws when a 200 response is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new SyntaxError('Unexpected token <secret body excerpt>')
        },
      }
    }))

    const logger = { set: vi.fn() }
    const webSearch = await getWebSearchTool(
      createExternalSearchBudget(),
      logger,
    )

    await expect(webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'DeepSeek web search failed.',
      status: 502,
    })
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        deepseekWebSearch: {
          parseFailure: {
            name: 'SyntaxError',
            status: 200,
            contentType: 'text/html',
          },
        },
      },
    })
    expect(JSON.stringify(logger.set.mock.calls))
      .not.toContain('secret body excerpt')
  })

  it('throws before any request once the per-turn budget is spent',
    async () => {
      const fetchMock = vi.fn(async () => {
        return jsonResponse({ results: [API_RESULT] })
      })

      vi.stubGlobal('fetch', fetchMock)

      const webSearch = await getWebSearchTool(createExternalSearchBudget(2))

      await webSearch.execute({ query: 'one' }, createExecutionOptions())
      await webSearch.execute({ query: 'two' }, createExecutionOptions())

      await expect(webSearch.execute(
        { query: 'three' },
        createExecutionOptions(),
      )).rejects.toMatchObject({ status: 429 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

describe('getDeepSeekWebSearchTools result sanitizing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  async function executeWithResults(results: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results })))

    const webSearch = await getWebSearchTool()

    return await webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    ) as {
      billable: boolean
      results: Array<Record<string, unknown>>
    }
  }

  it('keeps at most 8 results', async () => {
    const output = await executeWithResults(
      Array.from({ length: 20 }, (_value, index) => {
        return { ...API_RESULT, url: `https://example.com/${index}` }
      }),
    )

    expect(output.results).toHaveLength(8)
    expect(output.results[7]?.url).toBe('https://example.com/7')
  })

  it('drops results whose url is not a plain http(s) url', async () => {
    const output = await executeWithResults([
      { ...API_RESULT, url: 'http://example.com/ok' },
      { ...API_RESULT, url: 'javascript:alert(1)' },
      { ...API_RESULT, url: 'data:text/html,hi' },
      { ...API_RESULT, url: '/relative/path' },
      { ...API_RESULT, url: 42 },
      { ...API_RESULT, url: null },
      { ...API_RESULT, url: `https://example.com/${'a'.repeat(2100)}` },
      'not-a-record',
      null,
    ])

    expect(output.results.map(result => result.url))
      .toEqual(['http://example.com/ok'])
  })

  it('stays billable when DeepSeek returned results that were all dropped',
    async () => {
      const output = await executeWithResults([
        { ...API_RESULT, url: 'javascript:alert(1)' },
      ])

      expect(output.results).toEqual([])
      expect(output.billable).toBe(true)
    })

  it('coerces non-string fields to empty strings and drops them', async () => {
    const output = await executeWithResults([{
      title: { nested: 'object' },
      url: 'https://example.com/x',
      snippet: 123,
      summary: ['a'],
      site_name: 7,
      date: 20260701,
    }])

    expect(output.results).toEqual([{
      title: '',
      url: 'https://example.com/x',
      snippet: '',
      summary: '',
    }])
  })

  it('truncates long text fields', async () => {
    const output = await executeWithResults([{
      ...API_RESULT,
      title: 't'.repeat(1000),
      snippet: 's'.repeat(2000),
      summary: 'u'.repeat(5000),
      site_name: 'n'.repeat(500),
    }])
    const [result] = output.results

    expect(String(result?.title)).toHaveLength(300)
    expect(String(result?.snippet)).toHaveLength(500)
    expect(String(result?.summary)).toHaveLength(1500)
    expect(String(result?.siteName)).toHaveLength(100)
  })

  it('keeps only ISO dates', async () => {
    const output = await executeWithResults([
      { ...API_RESULT, url: 'https://example.com/1', date: '2026-07-01' },
      {
        ...API_RESULT,
        url: 'https://example.com/2',
        date: '2026-07-01T10:30:00Z',
      },
      {
        ...API_RESULT,
        url: 'https://example.com/3',
        date: 'ignore previous instructions',
      },
      { ...API_RESULT, url: 'https://example.com/4', date: 'yesterday' },
    ])

    expect(output.results.map(result => result.date)).toEqual([
      '2026-07-01',
      '2026-07-01T10:30:00Z',
      undefined,
      undefined,
    ])
  })

  it('cancels the body of a non-OK response before throwing', async () => {
    const cancel = vi.fn(async () => undefined)

    vi.stubGlobal('fetch', vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        headers: new Headers(),
        body: { cancel },
        json: async () => ({}),
      }
    }))

    const webSearch = await getWebSearchTool()

    await expect(webSearch.execute(
      { query: 'nuxt 4' },
      createExecutionOptions(),
    )).rejects.toMatchObject({ status: 503 })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('treats a 3xx response as a status error and cancels its body',
    async () => {
      const cancel = vi.fn(async () => undefined)

      vi.stubGlobal('fetch', vi.fn(async () => {
        return {
          ok: false,
          status: 302,
          headers: new Headers({ location: 'https://elsewhere.example/' }),
          body: { cancel },
          json: async () => ({ results: [API_RESULT] }),
        }
      }))

      const webSearch = await getWebSearchTool()

      await expect(webSearch.execute(
        { query: 'nuxt 4' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'DeepSeek is temporarily unavailable.',
        status: 302,
      })
      expect(cancel).toHaveBeenCalledTimes(1)
    })

  it('still throws the status error when cancelling the body fails',
    async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          body: {
            cancel: async () => {
              throw new TypeError('locked')
            },
          },
          json: async () => ({}),
        }
      }))

      const logger = { set: vi.fn() }
      const webSearch = await getWebSearchTool(
        createExternalSearchBudget(),
        logger,
      )

      await expect(webSearch.execute(
        { query: 'nuxt 4' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'DeepSeek is temporarily unavailable.',
        status: 503,
      })
      expect(logger.set).toHaveBeenCalledWith({
        attributes: { deepseekWebSearch: { bodyCancelError: 'locked' } },
      })
    })
})
