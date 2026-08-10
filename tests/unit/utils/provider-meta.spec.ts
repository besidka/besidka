import { describe, expect, it } from 'vitest'
import {
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

  it('returns undefined for an unknown provider id', () => {
    expect(resolveProviderMetaByKeyProviderId('unknown-provider'))
      .toBeUndefined()
  })
})
