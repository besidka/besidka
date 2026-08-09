import { describe, expect, it } from 'vitest'
import {
  deriveGatewayImageGenerationSupport,
  isGatewayToolAllowed,
  resolveGatewayWebSearchSupport,
  WEB_SEARCH_TOOLTIP,
} from '../../../shared/utils/gateway-capabilities'

describe('isGatewayToolAllowed', () => {
  it('allows web_search on openrouter and vercel', () => {
    expect(isGatewayToolAllowed('openrouter', 'web_search')).toBe(true)
    expect(isGatewayToolAllowed('vercel', 'web_search')).toBe(true)
  })

  it('rejects web_search on cloudflare', () => {
    expect(isGatewayToolAllowed('cloudflare', 'web_search')).toBe(false)
  })

  it('rejects image_generation on every gateway', () => {
    expect(isGatewayToolAllowed('openrouter', 'image_generation')).toBe(false)
    expect(isGatewayToolAllowed('vercel', 'image_generation')).toBe(false)
    expect(isGatewayToolAllowed('cloudflare', 'image_generation')).toBe(false)
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

describe('WEB_SEARCH_TOOLTIP', () => {
  it('spells out native vs. gateway-billed, doubling as the cost hint', () => {
    expect(WEB_SEARCH_TOOLTIP.native).toBe('Web search (native)')
    expect(WEB_SEARCH_TOOLTIP.universal)
      .toBe('Web search (via gateway, billed per search)')
  })
})
