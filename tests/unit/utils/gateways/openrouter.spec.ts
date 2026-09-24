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

function stubKeyLookup(apiKey: string | null = 'encrypted-key') {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: {
        findFirst: vi.fn(async () => (apiKey ? { apiKey } : undefined)),
      },
    },
  }))
  vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
}

async function importUseOpenRouterGateway() {
  const { useOpenRouterGateway } = await import(
    '../../../../server/utils/gateways/openrouter'
  )

  return useOpenRouterGateway
}

function readInstanceSettings(instance: unknown) {
  return (instance as unknown as {
    modelId: string
    settings: {
      usage?: { include: boolean }
      plugins?: unknown[]
      reasoning?: { effort?: string }
      extraBody?: Record<string, unknown>
    }
  })
}

describe('useOpenRouterGateway', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('throws a 401-style error when no key is stored', async () => {
    stubKeyLookup(null)

    const useOpenRouterGateway = await importUseOpenRouterGateway()

    await expect(
      useOpenRouterGateway('1', 'anthropic/claude-opus-5', [], 'off'),
    ).rejects.toMatchObject({
      message: 'OpenRouter API key not found',
      status: 401,
    })
  })

  it('builds an instance with usage accounting enabled and no tools', async () => {
    stubKeyLookup()

    const useOpenRouterGateway = await importUseOpenRouterGateway()
    const result = await useOpenRouterGateway(
      '1',
      'anthropic/claude-opus-5',
      [],
      'off',
    )

    expect(result.tools).toEqual({})
    expect(result.providerOptions).toEqual({})
    expect(typeof result.generateChatTitle).toBe('function')

    const instance = readInstanceSettings(result.instance)

    expect(instance.modelId).toBe('anthropic/claude-opus-5')
    expect(instance.settings.usage).toEqual({ include: true })
    expect(instance.settings.plugins).toBeUndefined()
    expect(instance.settings.reasoning).toBeUndefined()
    expect(result.reasoning).toBeUndefined()
  })

  it('never sets maxOutputTokens, so gateway sends stay uncapped', async () => {
    stubKeyLookup()

    const useOpenRouterGateway = await importUseOpenRouterGateway()
    const result = await useOpenRouterGateway(
      '1',
      'anthropic/claude-opus-5',
      [],
      'off',
    )

    expect(result.maxOutputTokens).toBeUndefined()
  })

  it('wires generateChatTitle through useChatTitle with the built instance', async () => {
    stubKeyLookup()

    const useChatTitleMock = vi.fn(async () => 'A title')

    vi.stubGlobal('useChatTitle', useChatTitleMock)

    const useOpenRouterGateway = await importUseOpenRouterGateway()
    const result = await useOpenRouterGateway(
      '1',
      'anthropic/claude-opus-5',
      [],
      'off',
    )

    const title = await result.generateChatTitle('Plan a trip to Kyoto')

    expect(title).toBe('A title')
    expect(useChatTitleMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic/claude-opus-5' }),
      'Plan a trip to Kyoto',
    )
  })

  describe('web search requested', () => {
    it('sends the universal web plugin on the chat instance, keeping '
      + 'tools empty', async () => {
      stubKeyLookup()

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5.4',
        ['web_search'],
        'off',
      )

      const instance = readInstanceSettings(result.instance)

      expect(instance.settings.plugins).toEqual([{ id: 'web' }])
      expect(instance.settings.usage).toEqual({ include: true })
      expect(result.tools).toEqual({})
      expect(result.providerOptions).toEqual({})
    })

    it('never carries the plugin into the title-generation instance, so '
      + 'titles never trigger a second billable search', async () => {
      stubKeyLookup()

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5.4',
        ['web_search'],
        'off',
      )

      await result.generateChatTitle('Plan a trip to Kyoto')

      const titleInstance = readInstanceSettings(
        useChatTitleMock.mock.calls[0]?.[0],
      )

      expect(titleInstance.settings.plugins).toBeUndefined()
    })
  })

  describe('reasoning requested', () => {
    it('sets a reasoning.effort chat setting for a supported level', async () => {
      stubKeyLookup()

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5.4',
        [],
        'high',
      )

      const instance = readInstanceSettings(result.instance)

      expect(instance.settings.reasoning).toEqual({ effort: 'high' })
      expect(result.reasoning).toBe('high')
    })

    it('sets no reasoning chat setting and returns undefined for off',
      async () => {
        stubKeyLookup()

        const useOpenRouterGateway = await importUseOpenRouterGateway()
        const result = await useOpenRouterGateway(
          '1',
          'openai/gpt-5.4',
          [],
          'off',
        )

        const instance = readInstanceSettings(result.instance)

        expect(instance.settings.reasoning).toBeUndefined()
        expect(result.reasoning).toBeUndefined()
      })

    it('never carries reasoning into the title-generation instance, so '
      + 'titles never spend extra reasoning tokens', async () => {
      stubKeyLookup()

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5.4',
        [],
        'high',
      )

      await result.generateChatTitle('Plan a trip to Kyoto')

      const titleInstance = readInstanceSettings(
        useChatTitleMock.mock.calls[0]?.[0],
      )

      expect(titleInstance.settings.reasoning).toBeUndefined()
    })
  })

  describe('image generation requested', () => {
    it('sends modalities: [image, text] via extraBody, keeping tools '
      + 'empty', async () => {
      stubKeyLookup()

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5-image',
        ['image_generation'],
        'off',
      )

      const instance = readInstanceSettings(result.instance)

      expect(instance.settings.extraBody).toEqual({
        modalities: ['image', 'text'],
      })
      expect(result.tools).toEqual({})
      expect(result.providerOptions).toEqual({})
    })

    it('leaves extraBody unset when image generation was not requested',
      async () => {
        stubKeyLookup()

        const useOpenRouterGateway = await importUseOpenRouterGateway()
        const result = await useOpenRouterGateway(
          '1',
          'openai/gpt-5-image',
          [],
          'off',
        )

        const instance = readInstanceSettings(result.instance)

        expect(instance.settings.extraBody).toBeUndefined()
      })

    it('never carries modalities into the title-generation instance, so '
      + 'titles never trigger an unwanted generated image', async () => {
      stubKeyLookup()

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5-image',
        ['image_generation'],
        'off',
      )

      await result.generateChatTitle('Plan a trip to Kyoto')

      const titleInstance = readInstanceSettings(
        useChatTitleMock.mock.calls[0]?.[0],
      )

      expect(titleInstance.settings.extraBody).toBeUndefined()
    })

    it('combines with web search on the same send, but never reasoning',
      async () => {
        stubKeyLookup()

        const useOpenRouterGateway = await importUseOpenRouterGateway()
        const result = await useOpenRouterGateway(
          '1',
          'openai/gpt-5-image',
          ['image_generation', 'web_search'],
          'medium',
        )

        const instance = readInstanceSettings(result.instance)

        expect(instance.settings.extraBody).toEqual({
          modalities: ['image', 'text'],
        })
        expect(instance.settings.plugins).toEqual([{ id: 'web' }])
        expect(instance.settings.reasoning).toBeUndefined()
        expect(result.reasoning).toBeUndefined()
      })

    it('never sends a reasoning setting when image generation is '
      + 'requested, even at a supported reasoning level', async () => {
      stubKeyLookup()

      const useOpenRouterGateway = await importUseOpenRouterGateway()
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5-image',
        ['image_generation'],
        'high',
      )

      const instance = readInstanceSettings(result.instance)

      expect(instance.settings.reasoning).toBeUndefined()
      expect(result.reasoning).toBeUndefined()
    })
  })

  describe('toolCall resolution for the Brave/Exa gate', () => {
    async function importWithCatalog(model: unknown) {
      const findGatewayCatalogModel = vi.fn(async () => model)

      vi.doMock('../../../../server/utils/gateways/catalog', () => ({
        findGatewayCatalogModel,
        getCachedGatewayCatalog: vi.fn(async () => []),
      }))

      return {
        useOpenRouterGateway: await importUseOpenRouterGateway(),
        findGatewayCatalogModel,
      }
    }

    it('resolves toolCall from the catalog when an external search tool is '
      + 'requested', async () => {
      stubKeyLookup()

      const {
        useOpenRouterGateway,
        findGatewayCatalogModel,
      } = await importWithCatalog({ id: 'x', toolCall: true })
      const result = await useOpenRouterGateway(
        '1',
        'anthropic/claude-opus-5',
        ['web_search_brave'],
        'off',
      )

      expect(findGatewayCatalogModel).toHaveBeenCalled()
      expect(result.toolCall).toBe(true)
    })

    it('reports a false toolCall so the send path can reject the search',
      async () => {
        stubKeyLookup()

        const { useOpenRouterGateway } = await importWithCatalog({
          id: 'x',
          toolCall: false,
        })
        const result = await useOpenRouterGateway(
          '1',
          'anthropic/claude-opus-5',
          ['web_search_exa'],
          'off',
        )

        expect(result.toolCall).toBe(false)
      })

    it('leaves toolCall undefined on a catalog miss, which the send path '
      + 'also treats as "do not offer Brave/Exa"', async () => {
      stubKeyLookup()

      const { useOpenRouterGateway } = await importWithCatalog(undefined)
      const result = await useOpenRouterGateway(
        '1',
        'anthropic/claude-opus-5',
        ['web_search_brave'],
        'off',
      )

      expect(result.toolCall).toBeUndefined()
    })

    it('skips the catalog lookup entirely when no external search tool was '
      + 'requested, keeping the ordinary send path free of it', async () => {
      stubKeyLookup()

      const {
        useOpenRouterGateway,
        findGatewayCatalogModel,
      } = await importWithCatalog({ id: 'x', toolCall: true })
      const result = await useOpenRouterGateway(
        '1',
        'anthropic/claude-opus-5',
        ['web_search'],
        'off',
      )

      expect(findGatewayCatalogModel).not.toHaveBeenCalled()
      expect(result.toolCall).toBeUndefined()
    })
  })
})
