import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('evlog', () => ({
  createError: (input: { message: string }) => {
    return Object.assign(new Error(input.message), input)
  },
}))

function stubKeyLookup(apiKey: string) {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: {
        findFirst: vi.fn(async () => ({ apiKey })),
      },
    },
  }))
}

function stubCatalog() {
  vi.stubGlobal('useStorage', () => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  }))
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  })))
}

interface HeaderInstance {
  config: { headers: () => Record<string, string> }
}

interface SettingsInstance {
  settings: { provider?: { zdr?: boolean } }
}

describe('gateway safeguards for chats that hold Google data', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    stubCatalog()
  })

  describe('Vercel AI Gateway', () => {
    it('asks for zero-data-retention routing on a guarded call', async () => {
      stubKeyLookup('encrypted-key')
      vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))

      const { useVercelGateway } = await import(
        '../../../../server/utils/gateways/vercel'
      )
      const result = await useVercelGateway(
        '1',
        'openai/gpt-4o',
        [],
        'off',
        undefined,
        { googleDataSafeguards: true },
      )

      expect(result.providerOptions).toEqual({
        gateway: { caching: 'auto', zeroDataRetention: true },
      })
    })

    it('keeps zero-data-retention on an image generation call', async () => {
      const { buildVercelProviderOptions } = await import(
        '../../../../server/utils/gateways/vercel'
      )

      expect(buildVercelProviderOptions({
        isImageGenerationRequested: true,
        googleDataSafeguards: true,
      })).toEqual({ gateway: { zeroDataRetention: true } })
    })

    it('sends nothing new on an ordinary call', async () => {
      const { buildVercelProviderOptions } = await import(
        '../../../../server/utils/gateways/vercel'
      )

      expect(buildVercelProviderOptions({
        isImageGenerationRequested: false,
        googleDataSafeguards: false,
      })).toEqual({ gateway: { caching: 'auto' } })
      expect(buildVercelProviderOptions({
        isImageGenerationRequested: true,
        googleDataSafeguards: false,
      })).toEqual({})
    })
  })

  describe('OpenRouter', () => {
    async function buildOpenRouter(googleDataSafeguards?: boolean) {
      stubKeyLookup('encrypted-key')
      vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const { useOpenRouterGateway } = await import(
        '../../../../server/utils/gateways/openrouter'
      )
      const result = await useOpenRouterGateway(
        '1',
        'openai/gpt-5.4',
        [],
        'off',
        undefined,
        googleDataSafeguards === undefined ? {} : { googleDataSafeguards },
      )

      await result.generateChatTitle('Plan a trip')

      return {
        chat: result.instance as unknown as SettingsInstance,
        title: useChatTitleMock.mock.calls[0]?.[0] as unknown as
          SettingsInstance,
      }
    }

    it('restricts routing to ZDR endpoints on the chat and the title',
      async () => {
        const { chat, title } = await buildOpenRouter(true)

        expect(chat.settings.provider).toEqual({ zdr: true })
        expect(title.settings.provider).toEqual({ zdr: true })
      })

    it('sends no provider preference on an ordinary call', async () => {
      const { chat, title } = await buildOpenRouter()

      expect(chat.settings.provider).toBeUndefined()
      expect(title.settings.provider).toBeUndefined()
    })
  })

  describe('Cloudflare AI Gateway', () => {
    async function buildCloudflare(googleDataSafeguards: boolean) {
      stubKeyLookup('encrypted-blob')
      vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
        accountId: 'account-123',
        apiKey: 'cf-token',
      })))

      const { useCloudflareGateway } = await import(
        '../../../../server/utils/gateways/cloudflare'
      )
      const result = await useCloudflareGateway(
        '1',
        '@cf/meta/llama-3.3-70b',
        undefined,
        { googleDataSafeguards },
      )

      return (result.instance as unknown as HeaderInstance).config.headers()
    }

    it('turns payload logging off on a guarded call', async () => {
      expect(await buildCloudflare(true)).toEqual(expect.objectContaining({
        'cf-aig-collect-log-payload': 'false',
      }))
    })

    it('leaves payload logging as configured on an ordinary call',
      async () => {
        expect(await buildCloudflare(false))
          .not.toHaveProperty('cf-aig-collect-log-payload')
      })
  })
})
