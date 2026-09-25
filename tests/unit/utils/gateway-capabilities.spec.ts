import { describe, expect, it } from 'vitest'
import {
  deriveGatewayImageGenerationSupport,
  isGatewayReasoningSupported,
  isGatewayToolAllowed,
  isOpenRouterMetaRouterModelId,
  resolveGatewayWebSearchSupport,
  WEB_SEARCH_TOOLTIP,
} from '#shared/utils/gateway-capabilities'

describe('isGatewayToolAllowed', () => {
  it('allows web_search on openrouter and vercel', () => {
    expect(isGatewayToolAllowed('openrouter', 'web_search')).toBe(true)
    expect(isGatewayToolAllowed('vercel', 'web_search')).toBe(true)
  })

  it('rejects web_search on cloudflare', () => {
    expect(isGatewayToolAllowed('cloudflare', 'web_search')).toBe(false)
  })

  it('allows image_generation on openrouter and vercel', () => {
    expect(isGatewayToolAllowed('openrouter', 'image_generation')).toBe(true)
    expect(isGatewayToolAllowed('vercel', 'image_generation')).toBe(true)
  })

  it('rejects image_generation on cloudflare, which has no image-output '
    + 'mechanism for the @cf/ catalog', () => {
    expect(isGatewayToolAllowed('cloudflare', 'image_generation')).toBe(false)
  })
})

describe('isGatewayReasoningSupported', () => {
  it('allows reasoning on openrouter and vercel', () => {
    expect(isGatewayReasoningSupported('openrouter')).toBe(true)
    expect(isGatewayReasoningSupported('vercel')).toBe(true)
  })

  it('rejects reasoning on cloudflare, which has no functional mechanism '
    + 'wired', () => {
    expect(isGatewayReasoningSupported('cloudflare')).toBe(false)
  })
})

describe('resolveGatewayWebSearchSupport', () => {
  it('resolves native when the raw catalog signal is present on a gateway '
    + 'whose policy allows web_search', () => {
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'openrouter',
      hasNativeSignal: true,
      isImageGenerationModel: false,
    })).toBe('native')
  })

  it('never resolves native for cloudflare, whose policy denies '
    + 'web_search, even if a raw catalog signal were ever reported',
  () => {
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'cloudflare',
      hasNativeSignal: true,
      isImageGenerationModel: false,
    })).toBeUndefined()
  })

  it('resolves universal for openrouter/vercel when there is no native '
    + 'signal and the model is not a confirmed image generator', () => {
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'openrouter',
      hasNativeSignal: false,
      isImageGenerationModel: false,
    })).toBe('universal')
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'vercel',
      hasNativeSignal: false,
      isImageGenerationModel: undefined,
    })).toBe('universal')
  })

  it('never resolves universal for cloudflare, which has no gateway-side '
    + 'search tool', () => {
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'cloudflare',
      hasNativeSignal: false,
      isImageGenerationModel: false,
    })).toBeUndefined()
  })

  it('excludes the universal resolution for a confirmed image-generation '
    + 'model', () => {
    expect(resolveGatewayWebSearchSupport({
      gatewayId: 'openrouter',
      hasNativeSignal: false,
      isImageGenerationModel: true,
    })).toBeUndefined()
  })

  it('does not treat an unknown image-generation status as an exclusion',
    () => {
      expect(resolveGatewayWebSearchSupport({
        gatewayId: 'vercel',
        hasNativeSignal: false,
        isImageGenerationModel: undefined,
      })).toBe('universal')
    })
})

describe('deriveGatewayImageGenerationSupport', () => {
  it('returns undefined when no output-modality data is reported', () => {
    expect(deriveGatewayImageGenerationSupport(undefined)).toBeUndefined()
  })

  it('returns true when the output modalities include image', () => {
    expect(deriveGatewayImageGenerationSupport(['image', 'text']))
      .toBe(true)
  })

  it('returns false when the output modalities are reported but exclude '
    + 'image', () => {
    expect(deriveGatewayImageGenerationSupport(['text'])).toBe(false)
  })
})

describe('isOpenRouterMetaRouterModelId', () => {
  it('identifies every id under the openrouter/ vendor prefix as a '
    + 'meta-router model', () => {
    expect(isOpenRouterMetaRouterModelId('openrouter/auto')).toBe(true)
    expect(isOpenRouterMetaRouterModelId('openrouter/auto-beta')).toBe(true)
    expect(isOpenRouterMetaRouterModelId('openrouter/free')).toBe(true)
    expect(isOpenRouterMetaRouterModelId('openrouter/fusion')).toBe(true)
    expect(isOpenRouterMetaRouterModelId('openrouter/pareto-code'))
      .toBe(true)
    expect(isOpenRouterMetaRouterModelId('openrouter/bodybuilder'))
      .toBe(true)
  })

  it('does not flag a regular vendor/model id, even one routed through '
    + 'a meta-router at request time', () => {
    expect(isOpenRouterMetaRouterModelId('z-ai/glm-5.2')).toBe(false)
    expect(isOpenRouterMetaRouterModelId('openai/gpt-5-image')).toBe(false)
  })
})

describe('WEB_SEARCH_TOOLTIP', () => {
  it('spells out native vs. gateway-billed, doubling as the cost hint', () => {
    expect(WEB_SEARCH_TOOLTIP.native).toBe('Web search')
    expect(WEB_SEARCH_TOOLTIP.universal)
      .toBe('Web search (gateway-billed)')
  })
})
