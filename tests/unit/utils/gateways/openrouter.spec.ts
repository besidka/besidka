import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    }
  })
}

describe('useOpenRouterGateway', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
  })

  it('throws a 401-style error when no key is stored', async () => {
    stubKeyLookup(null)

    const useOpenRouterGateway = await importUseOpenRouterGateway()

    await expect(
      useOpenRouterGateway('1', 'anthropic/claude-opus-5', [], 'off'),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'OpenRouter API key not found. Please set it up in the settings.',
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
})
