import { describe, expect, it } from 'vitest'
import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'

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
