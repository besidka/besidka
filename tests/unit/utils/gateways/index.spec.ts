import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importGatewaysIndex() {
  return await import('../../../../server/utils/gateways/index')
}

describe('keyProviderIdForGateway', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('maps GatewayId values to their keys.provider enum values', async () => {
    const { keyProviderIdForGateway } = await importGatewaysIndex()

    expect(keyProviderIdForGateway('vercel')).toBe('vercel-gateway')
    expect(keyProviderIdForGateway('openrouter')).toBe('openrouter')
  })
})

describe('readOpenRouterCost', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reads a numeric cost from OpenRouter provider metadata', async () => {
    const { readOpenRouterCost } = await importGatewaysIndex()

    expect(readOpenRouterCost({
      openrouter: { usage: { cost: 0.0042 } },
    } as any)).toBe(0.0042)
  })

  it('returns undefined when the metadata is absent or shaped unexpectedly', async () => {
    const { readOpenRouterCost } = await importGatewaysIndex()

    expect(readOpenRouterCost(undefined)).toBeUndefined()
    expect(readOpenRouterCost({} as any)).toBeUndefined()
    expect(readOpenRouterCost({
      openrouter: { usage: { cost: 'not-a-number' } },
    } as any)).toBeUndefined()
    expect(readOpenRouterCost({
      gateway: { generationId: 'gen_123' },
    } as any)).toBeUndefined()
  })
})

describe('readVercelGenerationId', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reads a string generation id from Vercel gateway provider metadata', async () => {
    const { readVercelGenerationId } = await importGatewaysIndex()

    expect(readVercelGenerationId({
      gateway: { generationId: 'gen_abc' },
    } as any)).toBe('gen_abc')
  })

  it('returns undefined when the metadata is absent or shaped unexpectedly', async () => {
    const { readVercelGenerationId } = await importGatewaysIndex()

    expect(readVercelGenerationId(undefined)).toBeUndefined()
    expect(readVercelGenerationId({} as any)).toBeUndefined()
    expect(readVercelGenerationId({
      gateway: { generationId: 42 },
    } as any)).toBeUndefined()
    expect(readVercelGenerationId({
      openrouter: { usage: { cost: 1 } },
    } as any)).toBeUndefined()
  })
})

describe('useGateway dispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('dispatches to the Vercel builder for the vercel gateway id', async () => {
    const vercelResult = { instance: {}, tools: {}, providerOptions: {} }

    vi.doMock('../../../../server/utils/gateways/vercel', () => ({
      useVercelGateway: vi.fn(async () => vercelResult),
    }))
    vi.doMock('../../../../server/utils/gateways/openrouter', () => ({
      useOpenRouterGateway: vi.fn(async () => {
        throw new Error('must not be called')
      }),
    }))

    const { useGateway } = await importGatewaysIndex()
    const result = await useGateway('vercel', '1', 'openai/gpt-4o')

    expect(result).toBe(vercelResult)
  })

  it('dispatches to the OpenRouter builder for the openrouter gateway id', async () => {
    const openRouterResult = { instance: {}, tools: {}, providerOptions: {} }

    vi.doMock('../../../../server/utils/gateways/vercel', () => ({
      useVercelGateway: vi.fn(async () => {
        throw new Error('must not be called')
      }),
    }))
    vi.doMock('../../../../server/utils/gateways/openrouter', () => ({
      useOpenRouterGateway: vi.fn(async () => openRouterResult),
    }))

    const { useGateway } = await importGatewaysIndex()
    const result = await useGateway(
      'openrouter',
      '1',
      'anthropic/claude-opus-5',
    )

    expect(result).toBe(openRouterResult)
  })
})
