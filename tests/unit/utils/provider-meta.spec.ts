import { describe, expect, it } from 'vitest'
import {
  providerMeta,
  resolveProviderMetaByKeyProviderId,
} from '../../../shared/utils/provider-meta'

describe('resolveProviderMetaByKeyProviderId', () => {
  it('resolves the cloudflare gateway from its keyProviderId', () => {
    const meta = resolveProviderMetaByKeyProviderId('cloudflare-gateway')

    expect(meta).toBe(providerMeta.cloudflare)
    expect(meta?.kind).toBe('gateway')
    expect(meta?.label).toBe('Cloudflare AI Gateway')
  })

  it('resolves the vercel gateway from its keyProviderId', () => {
    const meta = resolveProviderMetaByKeyProviderId('vercel-gateway')

    expect(meta).toBe(providerMeta.vercel)
    expect(meta?.kind).toBe('gateway')
    expect(meta?.label).toBe('Vercel AI Gateway')
  })

  it('resolves the openrouter gateway whose keyProviderId equals its own key', () => {
    const meta = resolveProviderMetaByKeyProviderId('openrouter')

    expect(meta).toBe(providerMeta.openrouter)
    expect(meta?.kind).toBe('gateway')
    expect(meta?.label).toBe('OpenRouter')
  })

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

  it('does not naively match a gateway keyProviderId as a providerMeta key', () => {
    expect(providerMeta['cloudflare-gateway']).toBeUndefined()
    expect(providerMeta['vercel-gateway']).toBeUndefined()

    expect(resolveProviderMetaByKeyProviderId('cloudflare-gateway'))
      .not.toBeUndefined()
    expect(resolveProviderMetaByKeyProviderId('vercel-gateway'))
      .not.toBeUndefined()
  })

  it('returns undefined for an unknown provider id', () => {
    expect(resolveProviderMetaByKeyProviderId('unknown-provider'))
      .toBeUndefined()
  })
})
