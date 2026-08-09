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

  it('extracts the real vendor from an @cf/vendor/model-slug id instead '
    + 'of the shared @cf namespace segment', () => {
    expect(
      getGatewayModelProviderPrefix(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      ),
    ).toBe('meta')
  })

  it('extracts the real vendor for every known Cloudflare vendor shape', () => {
    expect(getGatewayModelProviderPrefix('@cf/google/gemma-3-12b-it'))
      .toBe('google')
    expect(getGatewayModelProviderPrefix('@cf/mistralai/mistral-small-3.1'))
      .toBe('mistralai')
    expect(getGatewayModelProviderPrefix('@cf/deepseek-ai/deepseek-r1'))
      .toBe('deepseek-ai')
    expect(getGatewayModelProviderPrefix('@cf/ibm-granite/granite-3-8b'))
      .toBe('ibm-granite')
    expect(getGatewayModelProviderPrefix('@cf/qwen/qwen2.5-coder-32b'))
      .toBe('qwen')
    expect(getGatewayModelProviderPrefix('@cf/zai-org/glm-4.5'))
      .toBe('zai-org')
  })

  it('falls back to the whole @cf/vendor id when there is no third '
    + 'model-slug segment', () => {
    expect(getGatewayModelProviderPrefix('@cf/vendor-without-model'))
      .toBe('@cf')
  })

  it('falls back to the bare @cf namespace for the namespace alone', () => {
    expect(getGatewayModelProviderPrefix('@cf')).toBe('@cf')
    expect(getGatewayModelProviderPrefix('@cf/')).toBe('@cf')
  })
})
