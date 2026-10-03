import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '../../../../server/utils/ai/tool-loop'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

const EXA_SEARCH_RESPONSE = {
  requestId: 'req-1',
  results: [
    {
      id: 'https://github.com/besidka/besidka/',
      title: 'besidka/besidka',
      url: 'https://github.com/besidka/besidka/',
      publishedDate: '2025-06-16T08:06:04.000Z',
      author: 'besidka',
      highlights: ['Your digital besidka for all AI chats.', 'BYOK.'],
    },
    {
      id: 'https://example.com/no-title',
      title: null,
      url: 'https://example.com/no-title',
      highlights: ['A result with no title at all.'],
    },
  ],
  costDollars: {
    total: 0.007,
    search: { neural: 0.007 },
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
  return await import('../../../../server/utils/search/exa')
}

describe('getExaWebSearchTools tool shape', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('marks the tool with the follow-up-turn loop marker and sets no '
    + 'forced toolChoice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')

    expect(toolRequiresFollowUpTurn(result.tools?.web_search_exa)).toBe(true)
    expect(result.toolChoice).toBeUndefined()
  })

  it('registers the tool under web_search_exa, distinct from every native '
    + 'web_search* key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')

    expect(result.tools).toHaveProperty('web_search_exa')
    expect(result.tools).not.toHaveProperty('web_search')
    expect(result.tools).not.toHaveProperty('web_search_preview')
  })
})

describe('web_search_exa tool execute()', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('POSTs to Exa\'s /search endpoint with the x-api-key header, never '
    + 'Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await searchTool.execute(
      { query: 'latest developments in LLMs' },
      createExecutionOptions(),
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe('https://api.exa.ai/search')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-api-key': 'exa-key' })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('always sends the fixed, non-configurable request body: type auto, '
    + 'numResults 10, contents.highlights true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await searchTool.execute(
      { query: 'battery breakthroughs' },
      createExecutionOptions(),
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(body).toEqual({
      query: 'battery breakthroughs',
      type: 'auto',
      numResults: 10,
      contents: { highlights: true },
    })
  })

  it('normalizes results[] to { title, url, snippet, publishedDate, '
    + 'author } with highlights joined into the snippet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output.provider).toBe('exa')
    expect(output.results[0]).toEqual({
      title: 'besidka/besidka',
      url: 'https://github.com/besidka/besidka/',
      snippet: 'Your digital besidka for all AI chats. BYOK.',
      publishedDate: '2025-06-16T08:06:04.000Z',
      author: 'besidka',
    })
  })

  it('falls back to the result\'s hostname when title is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

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

  it('surfaces the response\'s costDollars.total as a flat costDollars '
    + 'field on the tool output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output.costDollars).toBe(0.007)
  })

  it('omits costDollars entirely when the response carries none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ results: [] }),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    const output = await searchTool.execute(
      { query: 'besidka' },
      createExecutionOptions(),
    )

    expect(output).not.toHaveProperty('costDollars')
  })

  it('propagates the AI SDK abort signal into the fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(EXA_SEARCH_RESPONSE),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa
    const controller = new AbortController()

    await searchTool.execute(
      { query: 'x' },
      createExecutionOptions(controller.signal),
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal?.aborted).toBe(false)

    controller.abort()

    expect(init.signal?.aborted).toBe(true)
  })

  it('throws a transient error when Exa responds with a 5xx status',
    async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        jsonResponse({}, { ok: false, status: 500 }),
      ))

      const { getExaWebSearchTools } = await importModule()
      const result = await getExaWebSearchTools('exa-key')
      const searchTool = result.tools?.web_search_exa

      await expect(searchTool.execute(
        { query: 'x' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'Exa is temporarily unavailable.',
        status: 500,
      })
    })

  it('tells the caller to update the key on a 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 401 }),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Exa rejected the saved API key.',
      status: 401,
      fix: 'Update the key in Profile > Keys, then try again.',
    })
  })

  it('reports quota/rate limiting distinctly on a 429/402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 429 }),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Exa is rate limited or out of quota.',
      status: 429,
    })
  })

  it('turns an AbortSignal.timeout() rejection into a readable transient '
    + 'error instead of an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    ))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Exa is temporarily unavailable.',
      status: 504,
      why: 'Exa\'s search request timed out.',
    })
  })

  it('rethrows a genuine caller abort untouched', async () => {
    const abortException = new DOMException('The user aborted.', 'AbortError')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortException))

    const { getExaWebSearchTools } = await importModule()
    const result = await getExaWebSearchTools('exa-key')
    const searchTool = result.tools?.web_search_exa

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toBe(abortException)
  })
})
