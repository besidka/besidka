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

    await expect(useOpenRouterGateway('1', 'anthropic/claude-opus-5'))
      .rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'OpenRouter API key not found. Please set it up in the settings.',
      })
  })

  it('builds an instance with usage accounting enabled and no tools', async () => {
    stubKeyLookup()

    const useOpenRouterGateway = await importUseOpenRouterGateway()
    const result = await useOpenRouterGateway('1', 'anthropic/claude-opus-5')

    expect(result.tools).toEqual({})
    expect(result.providerOptions).toEqual({})
    expect(typeof result.generateChatTitle).toBe('function')

    const instance = result.instance as unknown as {
      modelId: string
      settings: { usage?: { include: boolean } }
    }

    expect(instance.modelId).toBe('anthropic/claude-opus-5')
    expect(instance.settings.usage).toEqual({ include: true })
  })

  it('wires generateChatTitle through useChatTitle with the built instance', async () => {
    stubKeyLookup()

    const useChatTitleMock = vi.fn(async () => 'A title')

    vi.stubGlobal('useChatTitle', useChatTitleMock)

    const useOpenRouterGateway = await importUseOpenRouterGateway()
    const result = await useOpenRouterGateway('1', 'anthropic/claude-opus-5')

    const title = await result.generateChatTitle('Plan a trip to Kyoto')

    expect(title).toBe('A title')
    expect(useChatTitleMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic/claude-opus-5' }),
      'Plan a trip to Kyoto',
    )
  })
})
