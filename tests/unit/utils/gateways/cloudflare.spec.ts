import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
  })

  it('throws a 401-style error when no credentials are stored', async () => {
    stubKeyLookup(null)
    stubDecrypt('unused')

    const { useCloudflareGateway } = await importCloudflareGateway()

    await expect(useCloudflareGateway('1', 'llama-3.3-70b'))
      .rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'Cloudflare AI Gateway credentials not found. Please set them up in the settings.',
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
})
