import { describe, expect, it } from 'vitest'
import {
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
  it('gives every entry a kind of provider, search, or gateway', () => {
    const allowedKinds = ['provider', 'search', 'gateway']

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
