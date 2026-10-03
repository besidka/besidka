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
  web: {
    results: [
      {
        title: 'Besidka — AI Chat',
        url: 'https://www.besidka.com/',
        description: 'Bring your own API key and pay for what you use.',
      },
      {
        url: 'https://example.com/no-title',
        description: 'A result with no title at all.',
      },
    ],
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

  it('requests Brave\'s Web Search endpoint with the fixed params and the '
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
      'https://api.search.brave.com/res/v1/web/search',
    )
    expect(url.searchParams.get('q')).toBe('python web frameworks')
    expect(url.searchParams.get('count')).toBe('10')
    expect(url.searchParams.get('result_filter')).toBe('web')
    expect(init.headers).toMatchObject({
      'X-Subscription-Token': 'brave-key',
    })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('normalizes web.results[] to { title, url, snippet }', async () => {
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
    expect(output.results[0]).toEqual({
      title: 'Besidka — AI Chat',
      url: 'https://www.besidka.com/',
      snippet: 'Bring your own API key and pay for what you use.',
    })
  })

  it('falls back to the result\'s hostname when Brave omits a title',
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

      expect(output.results[1]).toEqual({
        title: 'example.com',
        url: 'https://example.com/no-title',
        snippet: 'A result with no title at all.',
      })
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
