import { describe, expect, it } from 'vitest'
import {
  cloudflareVendorIconOverrides,
  getGatewayModelProviderPrefix,
} from '#shared/utils/gateway-model-id'

describe('getGatewayModelProviderPrefix', () => {
  it('returns everything before the first slash', () => {
    expect(getGatewayModelProviderPrefix('anthropic/claude-opus-5'))
      .toBe('anthropic')
  })

  it('returns the full id when there is no slash', () => {
    expect(getGatewayModelProviderPrefix('bare-model-id'))
      .toBe('bare-model-id')
  })

  it('returns the raw vendor slug unnormalized', () => {
    expect(getGatewayModelProviderPrefix('x-ai/grok-4.20'))
      .toBe('x-ai')
  })

  it('preserves a tilde-prefixed "latest" alias vendor slug', () => {
    expect(getGatewayModelProviderPrefix('~anthropic/claude-opus-latest'))
      .toBe('~anthropic')
  })

  it('stops at the first slash for a multi-segment Cloudflare-style id', () => {
    expect(
      getGatewayModelProviderPrefix(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      ),
    ).toBe('@cf')
  })
})

describe('cloudflareVendorIconOverrides', () => {
  it('folds every Meta vendor slug onto one icon key', () => {
    expect(cloudflareVendorIconOverrides.meta).toBe('meta')
    expect(cloudflareVendorIconOverrides['meta-llama']).toBe('meta')
    expect(cloudflareVendorIconOverrides.facebook).toBe('meta')
  })

  it('folds both Mistral vendor slugs onto one icon key', () => {
    expect(cloudflareVendorIconOverrides.mistral).toBe('mistral')
    expect(cloudflareVendorIconOverrides.mistralai).toBe('mistral')
  })

  it('maps suffixed vendor slugs onto their parent brand', () => {
    expect(cloudflareVendorIconOverrides['deepseek-ai']).toBe('deepseek')
    expect(cloudflareVendorIconOverrides['ibm-granite']).toBe('ibm')
    expect(cloudflareVendorIconOverrides['zai-org']).toBe('zhipu')
    expect(cloudflareVendorIconOverrides['pipecat-ai']).toBe('pipecat')
  })

  it('omits vendors with no verified brand icon so they reach the badge',
    () => {
      const unmapped = [
        'baai',
        'black-forest-labs',
        'defog',
        'nousresearch',
        'stabilityai',
      ]

      for (const vendor of unmapped) {
        expect(cloudflareVendorIconOverrides[vendor]).toBeUndefined()
      }
    })

  it('is keyed by raw Cloudflare slugs, so a split prefix resolves directly',
    () => {
      const vendor = getGatewayModelProviderPrefix(
        'deepseek-ai/deepseek-r1-distill-qwen-32b',
      )

      expect(cloudflareVendorIconOverrides[vendor]).toBe('deepseek')
    })
})
