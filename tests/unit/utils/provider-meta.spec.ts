import { describe, expect, it } from 'vitest'
import {
  enabledGateways,
  enabledMemoryCheckProviders,
  enabledSearchProviders,
  providerMeta,
  resolveProviderMetaByKeyProviderId,
} from '../../../shared/utils/provider-meta'

describe('resolveProviderMetaByKeyProviderId', () => {
  it('resolves a direct provider whose persisted id equals its providerMeta key', () => {
    const meta = resolveProviderMetaByKeyProviderId('openai')

    expect(meta).toBe(providerMeta.openai)
    expect(meta?.kind).toBe('provider')
    expect(meta?.label).toBe('OpenAI')
  })

  it('resolves another direct provider the same way', () => {
    const meta = resolveProviderMetaByKeyProviderId('anthropic')

    expect(meta).toBe(providerMeta.anthropic)
    expect(meta?.kind).toBe('provider')
    expect(meta?.label).toBe('Anthropic')
  })

  it('resolves the brave search provider', () => {
    const meta = resolveProviderMetaByKeyProviderId('brave')

    expect(meta).toBe(providerMeta.brave)
    expect(meta?.kind).toBe('search')
    expect(meta?.label).toBe('Brave Search')
  })

  it('returns undefined for an unknown provider id', () => {
    expect(resolveProviderMetaByKeyProviderId('unknown-provider'))
      .toBeUndefined()
  })
})

describe('providerMeta kind discriminator', () => {
  it('gives every entry a kind of provider, search, gateway, or '
    + 'memory-check', () => {
    const allowedKinds = ['provider', 'search', 'gateway', 'memory-check']

    for (const meta of Object.values(providerMeta)) {
      expect(allowedKinds).toContain(meta.kind)
    }
  })
})

describe('enabledSearchProviders', () => {
  it('lists brave before exa, matching the product default', () => {
    expect(enabledSearchProviders).toEqual(['brave', 'exa'])
  })

  it('resolves to real providerMeta entries whose kind is search', () => {
    for (const providerId of enabledSearchProviders) {
      expect(providerMeta[providerId]?.kind).toBe('search')
    }
  })
})

describe('gateway providerMeta entries', () => {
  it('resolves each gateway keyProviderId, including the suffix trap', () => {
    expect(resolveProviderMetaByKeyProviderId('vercel-gateway'))
      .toBe(providerMeta.vercel)
    expect(resolveProviderMetaByKeyProviderId('cloudflare-gateway'))
      .toBe(providerMeta.cloudflare)
    expect(resolveProviderMetaByKeyProviderId('openrouter'))
      .toBe(providerMeta.openrouter)
  })

  it('gives every gateway entry kind gateway', () => {
    expect(providerMeta.vercel?.kind).toBe('gateway')
    expect(providerMeta.cloudflare?.kind).toBe('gateway')
    expect(providerMeta.openrouter?.kind).toBe('gateway')
  })

  it('gives Cloudflare three keyFields (accountId, optional gatewayId, '
    + 'apiKey), unlike every other single-apiKeyField entry', () => {
    const fieldNames = providerMeta.cloudflare?.keyFields.map((field) => {
      return field.name
    })

    expect(fieldNames).toEqual(['accountId', 'gatewayId', 'apiKey'])
    expect(providerMeta.cloudflare?.keyFields.find((field) => {
      return field.name === 'gatewayId'
    })?.required).toBe(false)
  })

  it('gives every other provider or search entry exactly one apiKey field', () => {
    for (const [id, meta] of Object.entries(providerMeta)) {
      if (id === 'cloudflare') {
        continue
      }

      expect(meta.keyFields).toHaveLength(1)
      expect(meta.keyFields[0]?.name).toBe('apiKey')
    }
  })
})

describe('memory-check providerMeta entries', () => {
  it('lists only TypeSafe AI as a memory-check provider', () => {
    expect(enabledMemoryCheckProviders).toEqual(['typesafe'])
  })

  it('resolves the TypeSafe AI key with its vendor casing and console '
    + 'link', () => {
    const meta = resolveProviderMetaByKeyProviderId('typesafe')

    expect(meta).toBe(providerMeta.typesafe)
    expect(meta?.kind).toBe('memory-check')
    expect(meta?.label).toBe('TypeSafe AI')
    expect(meta?.dashboardUrl).toBe('https://console.typesafe.ai/keys')
  })

  it('keeps memory-check keys out of the search and gateway lists', () => {
    for (const providerId of enabledMemoryCheckProviders) {
      expect(enabledSearchProviders).not.toContain(providerId)
      expect(enabledGateways as string[]).not.toContain(providerId)
    }
  })
})

describe('enabledGateways', () => {
  it('lists gateways in the documented cloudflare, openrouter, vercel order', () => {
    expect(enabledGateways).toEqual(['cloudflare', 'openrouter', 'vercel'])
  })

  it('resolves to real providerMeta entries whose kind is gateway', () => {
    for (const gatewayId of enabledGateways) {
      expect(providerMeta[gatewayId]?.kind).toBe('gateway')
    }
  })
})
