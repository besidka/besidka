import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '../../../../server/utils/ai/tool-loop'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

const DECLARATION_CACHE_KEY = 'moonshotai-web-search-tool-declaration:v1'

const WEB_SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    query: { description: 'What to search for', type: 'string' },
  },
  required: ['query'],
}

const TOOLS_ENDPOINT_RESPONSE = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: WEB_SEARCH_PARAMETERS,
      },
    },
  ],
}

function createFakeCache() {
  const store = new Map<string, unknown>()

  return {
    async getItem(key: string) {
      return store.get(key) ?? null
    },
    async setItem(key: string, value: unknown) {
      store.set(key, value)
    },
  }
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
  return await import(
    '../../../../server/utils/providers/moonshotai-web-search'
  )
}

describe('getMoonshotWebSearchTools declaration caching', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('fetches the live declaration from the Formula API tools endpoint '
    + 'on a cold cache', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.moonshot.ai/v1/formulas/moonshot/web-search:latest/tools',
      {
        headers: { authorization: 'Bearer moonshot-key' },
        signal: expect.any(AbortSignal),
      },
    )
    expect(result.tools).toHaveProperty('web_search')
  })

  it('gives the declaration fetch a timeout signal, so a hanging '
    + 'Moonshot outage degrades to a stale cache instead of stalling the '
    + 'chat send', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()

    await getMoonshotWebSearchTools('moonshot-key')

    const [, requestInit] = fetchMock.mock.calls[0]

    expect(requestInit.signal).toBeInstanceOf(AbortSignal)
    expect(requestInit.signal.aborted).toBe(false)
  })

  it('reuses the cached declaration and never refetches within the TTL',
    async () => {
      const cache = createFakeCache()
      const fetchMock = vi.fn()
        .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))

      vi.stubGlobal('useStorage', () => cache)
      vi.stubGlobal('fetch', fetchMock)

      const { getMoonshotWebSearchTools } = await importModule()

      await getMoonshotWebSearchTools('moonshot-key')
      await getMoonshotWebSearchTools('moonshot-key')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  it('never keys the cache by the caller\'s own API key, since the '
    + 'declaration is account-independent', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()

    await getMoonshotWebSearchTools('key-one')
    await getMoonshotWebSearchTools('key-two')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to a stale cached declaration when the live fetch fails, '
    + 'and reports it through the logger', async () => {
    const cache = createFakeCache()

    await cache.setItem(DECLARATION_CACHE_KEY, {
      declaration: {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: WEB_SEARCH_PARAMETERS,
      },
      cachedAt: 0,
    })

    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    const logger = { set: vi.fn() }

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key', logger)

    expect(result.tools).toHaveProperty('web_search')
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        moonshotWebSearchDeclarationFetch: {
          servedStale: true,
          error: 'network down',
        },
      },
    })
  })

  it('reports a failed cache write through the logger without failing '
    + 'the request, since the declaration was already fetched', async () => {
    const store = new Map<string, unknown>()
    const cache = {
      async getItem(key: string) {
        return store.get(key) ?? null
      },
      async setItem() {
        throw new Error('KV write failed')
      },
    }
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
    const logger = { set: vi.fn() }

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key', logger)

    expect(result.tools).toHaveProperty('web_search')
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        moonshotWebSearchDeclarationCacheWrite: {
          error: 'KV write failed',
        },
      },
    })
  })

  it('throws when the fetch fails and there is no cache to fall back to',
    async () => {
      const cache = createFakeCache()
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))

      vi.stubGlobal('useStorage', () => cache)
      vi.stubGlobal('fetch', fetchMock)

      const { getMoonshotWebSearchTools } = await importModule()

      await expect(getMoonshotWebSearchTools('moonshot-key'))
        .rejects.toThrow('network down')
    })

  it('throws a structured error when the declaration endpoint responds '
    + 'with a non-2xx status', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()

    await expect(getMoonshotWebSearchTools('moonshot-key'))
      .rejects.toMatchObject({
        message: 'Web search is temporarily unavailable for Moonshot AI.',
        status: 502,
      })
  })

  it('throws a structured error when the declaration response has no '
    + 'usable function shape', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tools: [] }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()

    await expect(getMoonshotWebSearchTools('moonshot-key'))
      .rejects.toMatchObject({
        message: 'Web search is temporarily unavailable for Moonshot AI.',
        status: 502,
      })
  })
})

describe('getMoonshotWebSearchTools tool shape', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('marks the tool with the follow-up-turn loop marker and sets no '
    + 'forced toolChoice', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(TOOLS_ENDPOINT_RESPONSE))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')

    expect(toolRequiresFollowUpTurn(result.tools?.web_search)).toBe(true)
    expect(result.toolChoice).toBeUndefined()
  })

  it('uses the live declaration\'s description as the tool description',
    async () => {
      const cache = createFakeCache()
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        tools: [{
          type: 'function',
          function: {
            name: 'web_search',
            description: 'A live description from Moonshot',
            parameters: WEB_SEARCH_PARAMETERS,
          },
        }],
      }))

      vi.stubGlobal('useStorage', () => cache)
      vi.stubGlobal('fetch', fetchMock)

      const { getMoonshotWebSearchTools } = await importModule()
      const result = await getMoonshotWebSearchTools('moonshot-key')

      expect(result.tools?.web_search?.description).toBe(
        'A live description from Moonshot',
      )
    })

  it('keys the tools record by whatever function name the live '
    + 'declaration reports', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      tools: [{
        type: 'function',
        function: {
          name: 'moonshot_web_search',
          description: 'Search the web',
          parameters: WEB_SEARCH_PARAMETERS,
        },
      }],
    }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')

    expect(result.tools).toHaveProperty('moonshot_web_search')
    expect(result.tools).not.toHaveProperty('web_search')
  })
})

describe('web_search tool execute()', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('posts to the fibers endpoint with the model-provided arguments and '
    + 'returns the encrypted output verbatim', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({
        id: 'fiber-f43p7sby7ny111houyq1',
        status: 'succeeded',
        context: {
          encrypted_output:
            '----MOONSHOT ENCRYPTED BEGIN----abc----MOONSHOT ENCRYPTED END----',
        },
      }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')
    const searchTool = result.tools?.web_search

    const output = await searchTool.execute(
      { query: 'latest Moonshot AI news' },
      createExecutionOptions(),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.moonshot.ai/v1/formulas/moonshot/web-search:latest/fibers',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'authorization': 'Bearer moonshot-key',
          'content-type': 'application/json',
        },
      }),
    )

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(body).toEqual({
      name: 'web_search',
      arguments: JSON.stringify({ query: 'latest Moonshot AI news' }),
    })
    expect(output).toBe(
      '----MOONSHOT ENCRYPTED BEGIN----abc----MOONSHOT ENCRYPTED END----',
    )
  })

  it('threads the AI SDK abort signal into the fiber fetch call', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({
        status: 'succeeded',
        context: { encrypted_output: 'ciphertext' },
      }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')
    const searchTool = result.tools?.web_search
    const controller = new AbortController()

    await searchTool.execute(
      { query: 'x' },
      createExecutionOptions(controller.signal),
    )

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]

    expect(init.signal).toBe(controller.signal)
  })

  it('falls back to the plain output field when no encrypted_output is '
    + 'present', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({
        status: 'succeeded',
        context: { output: 'plain, unprotected formula result' },
      }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')
    const searchTool = result.tools?.web_search

    const output = await searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )

    expect(output).toBe('plain, unprotected formula result')
  })

  it('throws when the fiber endpoint responds with a non-2xx status',
    async () => {
      const cache = createFakeCache()
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }))

      vi.stubGlobal('useStorage', () => cache)
      vi.stubGlobal('fetch', fetchMock)

      const { getMoonshotWebSearchTools } = await importModule()
      const result = await getMoonshotWebSearchTools('moonshot-key')
      const searchTool = result.tools?.web_search

      await expect(searchTool.execute(
        { query: 'x' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'Moonshot web search failed.',
        status: 502,
      })
    })

  it('throws when the fiber finishes with a non-succeeded status',
    async () => {
      const cache = createFakeCache()
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ status: 'failed', context: {} }))

      vi.stubGlobal('useStorage', () => cache)
      vi.stubGlobal('fetch', fetchMock)

      const { getMoonshotWebSearchTools } = await importModule()
      const result = await getMoonshotWebSearchTools('moonshot-key')
      const searchTool = result.tools?.web_search

      await expect(searchTool.execute(
        { query: 'x' },
        createExecutionOptions(),
      )).rejects.toMatchObject({
        message: 'Moonshot web search failed.',
        status: 502,
      })
    })

  it('throws a distinct error when the fiber succeeds but reports no '
    + 'output at all', async () => {
    const cache = createFakeCache()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOOLS_ENDPOINT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ status: 'succeeded', context: {} }))

    vi.stubGlobal('useStorage', () => cache)
    vi.stubGlobal('fetch', fetchMock)

    const { getMoonshotWebSearchTools } = await importModule()
    const result = await getMoonshotWebSearchTools('moonshot-key')
    const searchTool = result.tools?.web_search

    await expect(searchTool.execute(
      { query: 'x' },
      createExecutionOptions(),
    )).rejects.toMatchObject({
      message: 'Moonshot web search failed.',
      status: 502,
      why: 'Moonshot\'s fiber execution succeeded but returned no output.',
    })
  })
})
