import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

function stubKeyLookup(rawApiKeyColumn: string | null) {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: {
        findFirst: vi.fn(async () => (
          rawApiKeyColumn ? { apiKey: rawApiKeyColumn } : undefined
        )),
      },
    },
  }))
}

function stubDecrypt(decryptedValue: string) {
  vi.stubGlobal('useDecryptText', vi.fn(async () => decryptedValue))
}

function stubCloudflareCatalog(models: unknown[]) {
  vi.stubGlobal('useStorage', () => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  }))
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: models }),
  })))
}

async function importCloudflareGateway() {
  const module = await import(
    '../../../../server/utils/gateways/cloudflare'
  )

  return module
}

describe('getCloudflareGatewayCredentials', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns undefined when no key row is stored', async () => {
    stubKeyLookup(null)
    stubDecrypt('unused')

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toBeUndefined()
  })

  it('parses accountId, gatewayId, and apiKey from the decrypted blob', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      gatewayId: 'my-gateway',
      apiKey: 'cf-token',
    }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toEqual({
      accountId: 'account-123',
      gatewayId: 'my-gateway',
      apiKey: 'cf-token',
    })
  })

  it('omits gatewayId when it was never stored', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toEqual({
      accountId: 'account-123',
      gatewayId: undefined,
      apiKey: 'cf-token',
    })
  })

  it('normalizes a stored empty-string gatewayId to undefined', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      gatewayId: '',
      apiKey: 'cf-token',
    }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toEqual({
      accountId: 'account-123',
      gatewayId: undefined,
      apiKey: 'cf-token',
    })
  })

  it('looks the key up under the cloudflare-gateway provider id', async () => {
    const findFirst = vi.fn(async () => ({ apiKey: 'encrypted-blob' }))

    vi.stubGlobal('useDb', () => ({ query: { keys: { findFirst } } }))
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    await getCloudflareGatewayCredentials('1')

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'cloudflare-gateway',
        }),
      }),
    )
  })

  it('returns undefined when the decrypted blob is not valid JSON', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt('not-json')

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toBeUndefined()
  })

  it('returns undefined instead of throwing when decryption fails', async () => {
    stubKeyLookup('encrypted-blob')
    vi.stubGlobal('useDecryptText', vi.fn(async () => {
      throw new Error('Decryption key rotated')
    }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    await expect(getCloudflareGatewayCredentials('1'))
      .resolves.toBeUndefined()
  })

  it('returns undefined when required fields are missing from the blob', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({ accountId: 'account-123' }))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toBeUndefined()
  })

  it('returns undefined when the decrypted blob is a JSON array', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify(['account-123', 'cf-token']))

    const { getCloudflareGatewayCredentials } = await importCloudflareGateway()

    expect(await getCloudflareGatewayCredentials('1')).toBeUndefined()
  })
})

describe('useCloudflareGateway', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('throws a 401-style error when no credentials are stored', async () => {
    stubKeyLookup(null)
    stubDecrypt('unused')

    const { useCloudflareGateway } = await importCloudflareGateway()

    await expect(useCloudflareGateway('1', 'llama-3.3-70b'))
      .rejects.toMatchObject({
        message: 'Cloudflare AI Gateway credentials not found',
        status: 401,
      })
  })

  it('builds an instance against the account-scoped baseURL with no tools', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    expect(result.tools).toEqual({})
    expect(result.providerOptions).toEqual({})
    expect(typeof result.generateChatTitle).toBe('function')

    const instance = result.instance as unknown as {
      modelId: string
      config: { provider: string, headers: () => Record<string, string> }
    }

    expect(instance.modelId).toBe('llama-3.3-70b')
    expect(instance.config.provider).toContain('cloudflare')
    expect(instance.config.headers()).toEqual(
      expect.objectContaining({ 'cf-aig-gateway-id': 'default' }),
    )
  })

  it('sends an empty string instead of null content on an assistant '
    + 'tool-call turn', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', '@cf/openai/gpt-oss-120b')
    const requestBodies: Array<Record<string, unknown>> = []

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)))

      return new Response(JSON.stringify({
        id: 'chatcmpl-1',
        created: 0,
        model: '@cf/openai/gpt-oss-120b',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Paris.' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const instance = result.instance as unknown as {
      doGenerate: (options: unknown) => Promise<unknown>
    }

    await instance.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Capital?' }] },
        {
          role: 'assistant',
          content: [{
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'web_search_brave',
            input: { query: 'capital of France' },
          }],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'web_search_brave',
            output: { type: 'json', value: { results: [] } },
          }],
        },
      ],
    })

    const messages = requestBodies[0]?.messages as Array<
      Record<string, unknown>
    >
    const assistantMessage = messages.find((message) => {
      return message.role === 'assistant'
    })

    expect(assistantMessage).toMatchObject({ content: '' })
    expect(assistantMessage?.tool_calls).toHaveLength(1)
  })

  it('sends the search-answer continuation prompt as string user content',
    async () => {
      stubKeyLookup('encrypted-blob')
      stubDecrypt(JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      }))

      const { useCloudflareGateway } = await importCloudflareGateway()
      const { buildSearchAnswerContinuationMessages } = await import(
        '../../../../server/utils/ai/search-answer-continuation'
      )
      const { generateText } = await import('ai')
      const result = await useCloudflareGateway('1', '@cf/openai/gpt-oss-120b')
      const requestBodies: Array<Record<string, unknown>> = []

      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        requestBodies.push(JSON.parse(String(init.body)))

        return new Response(JSON.stringify({
          id: 'chatcmpl-1',
          created: 0,
          model: '@cf/openai/gpt-oss-120b',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Answer.' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }))

      await generateText({
        model: result.instance,
        messages: buildSearchAnswerContinuationMessages(
          [{ role: 'user', content: 'Latest news in Poland?' }],
          [{
            toolName: 'web_search_brave',
            input: { query: 'Poland news' },
            output: {
              results: [{
                title: 'Poland today',
                url: 'https://example.com/poland',
                snippet: 'Page content.',
              }],
            },
          }],
        ),
      })

      const messages = requestBodies[0]?.messages as Array<
        Record<string, unknown>
      >
      const userContent = messages.at(-1)?.content

      expect(typeof userContent).toBe('string')
      expect(userContent).toMatch(/^Latest news in Poland\?\n\n/)
      expect(userContent).toContain('Poland today')
    })

  it('sends the stored gatewayId instead of "default" when one was saved', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      gatewayId: 'my-gateway',
      apiKey: 'cf-token',
    }))

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    const instance = result.instance as unknown as {
      config: { headers: () => Record<string, string> }
    }

    expect(instance.config.headers()).toEqual(
      expect.objectContaining({ 'cf-aig-gateway-id': 'my-gateway' }),
    )
  })

  it('falls back to "default" when the stored gatewayId is an empty string', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      gatewayId: '',
      apiKey: 'cf-token',
    }))

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    const instance = result.instance as unknown as {
      config: { headers: () => Record<string, string> }
    }

    expect(instance.config.headers()).toEqual(
      expect.objectContaining({ 'cf-aig-gateway-id': 'default' }),
    )
  })

  it('never sets a client for background cost lookups, unlike Vercel', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    expect(result.client).toBeUndefined()
  })

  it('wires generateChatTitle through useChatTitle with the built instance', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))

    const useChatTitleMock = vi.fn(async () => 'A title')

    vi.stubGlobal('useChatTitle', useChatTitleMock)

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    const title = await result.generateChatTitle('Plan a trip to Kyoto')

    expect(title).toBe('A title')
    expect(useChatTitleMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'llama-3.3-70b' }),
      'Plan a trip to Kyoto',
    )
  })

  it('caps maxOutputTokens and pricing from the model\'s own catalog entry',
    async () => {
      stubKeyLookup('encrypted-blob')
      stubDecrypt(JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      }))
      stubCloudflareCatalog([
        {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          input_modalities: [
            {
              type: 'text',
              supported_inputs: { max_context_length: { value: 24000 } },
              pricing: [{ type: 'prompt', cost_usd: '0.0000002' }],
            },
          ],
          output_modalities: [
            {
              type: 'text',
              max_length: { value: 4096 },
              pricing: [{ type: 'completion', cost_usd: '0.0000009' }],
            },
          ],
        },
      ])

      const { useCloudflareGateway } = await importCloudflareGateway()
      const result = await useCloudflareGateway('1', 'llama-3.3-70b')

      expect(result.maxOutputTokens).toBe(4096)
      expect(result.pricing).toEqual({
        input: '0.0000002',
        output: '0.0000009',
      })
      expect(result.toolCall).toBe(false)
    })

  it('reads maxOutputTokens from the flat catalog shape a live account '
    + 'returns', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))
    stubCloudflareCatalog([
      {
        id: '@cf/openai/gpt-oss-120b',
        name: 'OpenAI: Gpt Oss 120B',
        input_modalities: ['text'],
        output_modalities: ['text'],
        context_length: 128000,
        max_output_length: 128000,
      },
    ])

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', '@cf/openai/gpt-oss-120b')

    expect(result.maxOutputTokens).toBe(128000)
  })

  it('passes the unclamped catalog max_output_length to the chat title',
    async () => {
      stubKeyLookup('encrypted-blob')
      stubDecrypt(JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      }))
      stubCloudflareCatalog([
        {
          id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          name: 'Meta: Llama 3.3 70B',
          input_modalities: ['text'],
          output_modalities: ['text'],
          context_length: 24000,
          max_output_length: 24000,
        },
      ])

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const { useCloudflareGateway } = await importCloudflareGateway()
      const result = await useCloudflareGateway(
        '1',
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      )

      await result.generateChatTitle('Plan a trip to Kyoto')

      expect(result.maxOutputTokens).toBe(24000)
      expect(useChatTitleMock).toHaveBeenCalledWith(
        expect.anything(),
        'Plan a trip to Kyoto',
        24000,
      )
    })

  it('leaves maxOutputTokens, pricing and toolCall undefined when the model '
    + 'is not in the catalog', async () => {
    stubKeyLookup('encrypted-blob')
    stubDecrypt(JSON.stringify({
      accountId: 'account-123',
      apiKey: 'cf-token',
    }))
    stubCloudflareCatalog([])

    const { useCloudflareGateway } = await importCloudflareGateway()
    const result = await useCloudflareGateway('1', 'llama-3.3-70b')

    expect(result.maxOutputTokens).toBeUndefined()
    expect(result.pricing).toBeUndefined()
    expect(result.toolCall).toBeUndefined()
  })

  it('passes the catalog maxOutputTokens through to generateChatTitle',
    async () => {
      stubKeyLookup('encrypted-blob')
      stubDecrypt(JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      }))
      stubCloudflareCatalog([
        {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          output_modalities: [
            { type: 'text', max_length: { value: 4096 } },
          ],
        },
      ])

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const { useCloudflareGateway } = await importCloudflareGateway()
      const result = await useCloudflareGateway('1', 'llama-3.3-70b')

      await result.generateChatTitle('Plan a trip to Kyoto')

      expect(useChatTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'llama-3.3-70b' }),
        'Plan a trip to Kyoto',
        4096,
      )
    })
})

describe('withContextSizedMaxTokens', () => {
  const SMALL_CONTEXT = 24000
  const FIFTEEN_THOUSAND_TOKENS_OF_TEXT = 'word '.repeat(7500)

  function chatBody(content: string, maxTokens: number = SMALL_CONTEXT) {
    return {
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    }
  }

  it('keeps a large max_tokens for a short prompt', async () => {
    const { withContextSizedMaxTokens } = await importCloudflareGateway()
    const result = withContextSizedMaxTokens(
      chatBody('Plan a trip to Kyoto'),
      SMALL_CONTEXT,
    )

    expect(result.max_tokens).toBeGreaterThan(20000)
    expect(result.max_tokens).toBeLessThan(SMALL_CONTEXT)
  })

  it('never lets prompt plus output exceed the context for a long prompt',
    async () => {
      const { withContextSizedMaxTokens } = await importCloudflareGateway()
      const body = chatBody('x'.repeat(40_000))
      const result = withContextSizedMaxTokens(body, SMALL_CONTEXT)
      const promptTokensAtOneCharacterPerToken = JSON.stringify(
        body.messages,
      ).length

      expect(result.max_tokens).toBeLessThan(SMALL_CONTEXT - 15000)
      expect(result.max_tokens).toBeGreaterThanOrEqual(256)
      expect(
        (result.max_tokens as number)
        + Math.ceil(promptTokensAtOneCharacterPerToken / 2.5),
      ).toBeLessThanOrEqual(SMALL_CONTEXT)
    })

  it('sizes a roughly fifteen thousand token prompt below the context',
    async () => {
      const { withContextSizedMaxTokens } = await importCloudflareGateway()
      const result = withContextSizedMaxTokens(
        chatBody(FIFTEEN_THOUSAND_TOKENS_OF_TEXT),
        SMALL_CONTEXT,
      )

      expect(result.max_tokens).toBeGreaterThanOrEqual(256)
      expect(result.max_tokens).toBeLessThan(SMALL_CONTEXT - 15000)
    })

  it('never raises a max_tokens that is already below the budget',
    async () => {
      const { withContextSizedMaxTokens } = await importCloudflareGateway()
      const result = withContextSizedMaxTokens(
        chatBody('Hi', 100),
        SMALL_CONTEXT,
      )

      expect(result.max_tokens).toBe(100)
    })

  it('omits max_tokens when the prompt leaves less than the minimum budget',
    async () => {
      const { withContextSizedMaxTokens } = await importCloudflareGateway()
      const body = chatBody('x'.repeat(57_000))
      const result = withContextSizedMaxTokens(body, SMALL_CONTEXT)

      expect(result).not.toHaveProperty('max_tokens')
      expect(result.messages).toEqual(body.messages)
      expect(result.model).toBe(body.model)
      expect(body.max_tokens).toBe(SMALL_CONTEXT)
    })

  it('omits max_tokens when the prompt alone exceeds the context',
    async () => {
      const { withContextSizedMaxTokens } = await importCloudflareGateway()
      const result = withContextSizedMaxTokens(
        chatBody('x'.repeat(100_000)),
        SMALL_CONTEXT,
      )

      expect(result).not.toHaveProperty('max_tokens')
    })

  it('counts tool definitions toward the prompt', async () => {
    const { withContextSizedMaxTokens } = await importCloudflareGateway()
    const withoutTools = chatBody('Hi')
    const withTools = {
      ...withoutTools,
      tools: [{
        type: 'function',
        function: { name: 'search', description: 'y'.repeat(10_000) },
      }],
    }

    expect(
      withContextSizedMaxTokens(withTools, SMALL_CONTEXT).max_tokens as number,
    ).toBeLessThan(
      withContextSizedMaxTokens(withoutTools, SMALL_CONTEXT)
        .max_tokens as number,
    )
  })

  it('estimates Cyrillic text conservatively', async () => {
    const { withContextSizedMaxTokens } = await importCloudflareGateway()
    const cyrillicText = 'привіт світе '.repeat(1500)
    const result = withContextSizedMaxTokens(
      chatBody(cyrillicText),
      SMALL_CONTEXT,
    )
    const estimatedPromptTokens = Math.ceil(
      JSON.stringify({ messages: chatBody(cyrillicText).messages }).length
      / 2.5,
    )

    expect(result.max_tokens).toBeLessThanOrEqual(
      SMALL_CONTEXT - estimatedPromptTokens - 1024,
    )
    expect(result.max_tokens).toBeGreaterThan(
      SMALL_CONTEXT - estimatedPromptTokens - 1024 - 50,
    )
  })

  it('returns the body untouched when the context is unknown', async () => {
    const { withContextSizedMaxTokens } = await importCloudflareGateway()
    const body = chatBody('x'.repeat(100_000))

    expect(withContextSizedMaxTokens(body, undefined)).toBe(body)
  })

  it('returns bodies without max_tokens or messages untouched', async () => {
    const { withContextSizedMaxTokens } = await importCloudflareGateway()
    const withoutMaxTokens = { model: 'm', messages: [] }
    const nonChatBody = { model: 'm', input: 'x'.repeat(100_000) }

    expect(withContextSizedMaxTokens(withoutMaxTokens, SMALL_CONTEXT))
      .toBe(withoutMaxTokens)
    expect(withContextSizedMaxTokens(nonChatBody, SMALL_CONTEXT))
      .toBe(nonChatBody)
  })
})

describe('useCloudflareGateway request body', () => {
  it('sizes max_tokens from the catalog context on the outgoing request',
    async () => {
      stubKeyLookup('encrypted-blob')
      stubDecrypt(JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      }))
      stubCloudflareCatalog([
        {
          id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          name: 'Meta: Llama 3.3 70B',
          input_modalities: ['text'],
          output_modalities: ['text'],
          context_length: 24000,
          max_output_length: 24000,
        },
      ])

      const catalogFetch = vi.mocked(fetch)
      const { useCloudflareGateway } = await importCloudflareGateway()
      const result = await useCloudflareGateway(
        '1',
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      )

      catalogFetch.mockResolvedValue(new Response(JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { headers: { 'content-type': 'application/json' } }))

      await result.instance.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        maxOutputTokens: result.maxOutputTokens,
      })

      const [, init] = catalogFetch.mock.calls.at(-1) as [string, RequestInit]
      const sentBody = JSON.parse(init.body as string)

      expect(sentBody.max_tokens).toBeGreaterThan(20000)
      expect(sentBody.max_tokens).toBeLessThan(24000)
    })
})

describe('withStringMessageContent', () => {
  it('replaces null assistant content with an empty string', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()
    const toolCalls = [{ id: 'call-1', type: 'function' }]

    expect(withStringMessageContent({
      model: '@cf/openai/gpt-oss-120b',
      messages: [
        { role: 'user', content: 'Capital?' },
        {
          role: 'assistant',
          content: null,
          reasoning_content: 'Search first.',
          tool_calls: toolCalls,
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{}' },
      ],
    })).toEqual({
      model: '@cf/openai/gpt-oss-120b',
      messages: [
        { role: 'user', content: 'Capital?' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'Search first.',
          tool_calls: toolCalls,
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{}' },
      ],
    })
  })

  it('leaves string assistant content and non-assistant roles untouched',
    async () => {
      const { withStringMessageContent } = await importCloudflareGateway()
      const body = {
        messages: [
          { role: 'system', content: null },
          { role: 'assistant', content: 'Already text.' },
        ],
      }

      expect(withStringMessageContent(body)).toEqual(body)
    })

  it('joins a text-only content array into one string', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()

    expect(withStringMessageContent({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Latest news?' },
          { type: 'text', text: 'Search results.' },
        ],
      }],
    })).toEqual({
      messages: [{ role: 'user', content: 'Latest news?\n\nSearch results.' }],
    })
  })

  it('keeps the code fence of an inlined text file intact after the user '
    + 'text', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()
    const inlinedFile = '**notes.ts**\n\n```ts\nconst answer = 42\n```'

    expect(withStringMessageContent({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Explain this file' },
          { type: 'text', text: inlinedFile },
        ],
      }],
    })).toEqual({
      messages: [{
        role: 'user',
        content: `Explain this file\n\n${inlinedFile}`,
      }],
    })
  })

  it('joins a text-only assistant content array the same way', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()

    expect(withStringMessageContent({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'First.' },
          { type: 'text', text: 'Second.' },
        ],
      }],
    })).toEqual({
      messages: [{ role: 'assistant', content: 'First.\n\nSecond.' }],
    })
  })

  it('keeps a content array that holds a non-text part', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' } },
        ],
      }],
    }

    expect(withStringMessageContent(body)).toEqual(body)
  })

  it('returns a body without messages unchanged', async () => {
    const { withStringMessageContent } = await importCloudflareGateway()
    const body = { model: '@cf/openai/gpt-oss-120b', prompt: 'Hi' }

    expect(withStringMessageContent(body)).toBe(body)
  })
})
