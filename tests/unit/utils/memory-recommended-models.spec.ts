import { describe, expect, it } from 'vitest'
import type { RecommendedDirectModel }
  from '#shared/utils/memory-recommended-models'
import {
  getGatewayModelProviderId,
  getGatewayModelSlug,
  isRecommendedGatewayModel,
  normalizeModelSlug,
} from '#shared/utils/memory-recommended-models'

const recommendedDirectModels: RecommendedDirectModel[] = [
  { providerId: 'anthropic', modelId: 'claude-haiku-5-5' },
  { providerId: 'google', modelId: 'gemini-3.1-flash-lite' },
  { providerId: 'openai', modelId: 'gpt-6-luna' },
  { providerId: 'xai', modelId: 'grok-4.20-0309-non-reasoning' },
  { providerId: 'deepseek', modelId: 'deepseek-flash' },
  { providerId: 'moonshotai', modelId: 'kimi-k2.6' },
  { providerId: 'qwen', modelId: 'qwen3.8-flash' },
]

function isRecommended(gatewayModelId: string): boolean {
  return isRecommendedGatewayModel(gatewayModelId, recommendedDirectModels)
}

describe('normalizeModelSlug', () => {
  it('lower-cases and folds dots into dashes', () => {
    expect(normalizeModelSlug('Claude-Haiku-5.5')).toBe('claude-haiku-5-5')
  })

  it('strips a trailing compact release date', () => {
    expect(normalizeModelSlug('claude-haiku-5-5-20261001'))
      .toBe('claude-haiku-5-5')
  })

  it('strips a trailing dashed release date', () => {
    expect(normalizeModelSlug('gpt-6-luna-2026-10-01')).toBe('gpt-6-luna')
  })

  it('strips a trailing routing variant', () => {
    expect(normalizeModelSlug('kimi-k2.6:free')).toBe('kimi-k2-6')
    expect(normalizeModelSlug('claude-haiku-5.5:thinking'))
      .toBe('claude-haiku-5-5')
  })

  it('strips a date and a variant together', () => {
    expect(normalizeModelSlug('claude-haiku-5.5-20261001:free'))
      .toBe('claude-haiku-5-5')
  })

  it('keeps interior numeric segments that are not a trailing date', () => {
    expect(normalizeModelSlug('grok-4.20-0309-non-reasoning'))
      .toBe('grok-4-20-0309-non-reasoning')
    expect(normalizeModelSlug('grok-4.20-0309')).toBe('grok-4-20-0309')
  })

  it('does not treat a short trailing number as a date', () => {
    expect(normalizeModelSlug('qwen3.8-flash-2026')).toBe('qwen3-8-flash-2026')
  })
})

describe('getGatewayModelSlug', () => {
  it('returns what follows the vendor segment', () => {
    expect(getGatewayModelSlug('anthropic/claude-haiku-5.5'))
      .toBe('claude-haiku-5.5')
  })

  it('skips the @cf namespace and the vendor for Cloudflare ids', () => {
    expect(getGatewayModelSlug('@cf/moonshotai/kimi-k2.6'))
      .toBe('kimi-k2.6')
  })

  it('returns an empty slug when there is no vendor segment', () => {
    expect(getGatewayModelSlug('gpt-6-luna')).toBe('')
    expect(getGatewayModelSlug('@cf/vendor-without-model')).toBe('')
  })
})

describe('getGatewayModelProviderId', () => {
  it.each([
    ['anthropic/claude-haiku-5.5', 'anthropic'],
    ['google/gemini-3.1-flash-lite', 'google'],
    ['openai/gpt-6-luna', 'openai'],
    ['x-ai/grok-4.20-0309-non-reasoning', 'xai'],
    ['xai/grok-4.20-0309-non-reasoning', 'xai'],
    ['deepseek/deepseek-flash', 'deepseek'],
    ['@cf/deepseek-ai/deepseek-flash', 'deepseek'],
    ['moonshotai/kimi-k2.6', 'moonshotai'],
    ['qwen/qwen3.8-flash', 'qwen'],
    ['alibaba/qwen3.8-flash', 'qwen'],
    ['Anthropic/Claude-Haiku-5.5', 'anthropic'],
  ])('maps %s to %s', (gatewayModelId, providerId) => {
    expect(getGatewayModelProviderId(gatewayModelId)).toBe(providerId)
  })

  it.each([
    'meta-llama/llama-4-scout',
    'mistralai/mistral-small',
    '~anthropic/claude-haiku-latest',
    'openrouter/auto',
    'gpt-6-luna',
    '@cf/zai-org/glm-4.5',
  ])('returns null for %s', (gatewayModelId) => {
    expect(getGatewayModelProviderId(gatewayModelId)).toBeNull()
  })
})

describe('isRecommendedGatewayModel', () => {
  describe('OpenRouter ids', () => {
    it.each([
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
      'openai/gpt-6-luna',
      'x-ai/grok-4.20-0309-non-reasoning',
      'deepseek/deepseek-flash',
      'moonshotai/kimi-k2.6',
      'qwen/qwen3.8-flash',
    ])('recommends %s', (gatewayModelId) => {
      expect(isRecommended(gatewayModelId)).toBe(true)
    })

    it('recommends the free variant of a recommended model', () => {
      expect(isRecommended('moonshotai/kimi-k2.6:free')).toBe(true)
      expect(isRecommended('deepseek/deepseek-flash:free')).toBe(true)
    })

    it('recommends a dated snapshot of a recommended model', () => {
      expect(isRecommended('anthropic/claude-haiku-5.5-20261001')).toBe(true)
      expect(isRecommended('openai/gpt-6-luna-2026-10-01')).toBe(true)
    })
  })

  describe('Vercel AI Gateway ids', () => {
    it.each([
      'anthropic/claude-haiku-5-5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
      'openai/gpt-6-luna',
      'xai/grok-4.20-0309-non-reasoning',
      'deepseek/deepseek-flash',
      'moonshotai/kimi-k2.6',
      'alibaba/qwen3.8-flash',
    ])('recommends %s', (gatewayModelId) => {
      expect(isRecommended(gatewayModelId)).toBe(true)
    })
  })

  describe('Cloudflare ids', () => {
    it.each([
      'openai/gpt-6-luna',
      'google/gemini-3.1-flash-lite',
      '@cf/moonshotai/kimi-k2.6',
      '@cf/qwen/qwen3.8-flash',
      '@cf/deepseek-ai/deepseek-flash',
      '@cf/google/gemini-3.1-flash-lite',
      '@cf/openai/gpt-6-luna',
    ])('recommends %s', (gatewayModelId) => {
      expect(isRecommended(gatewayModelId)).toBe(true)
    })

    it('does not recommend other Workers AI models', () => {
      expect(isRecommended('@cf/openai/gpt-oss-120b')).toBe(false)
      expect(isRecommended('@cf/meta/llama-3.3-70b-instruct-fp8-fast'))
        .toBe(false)
      expect(isRecommended('@cf/qwen/qwen2.5-coder-32b-instruct'))
        .toBe(false)
      expect(isRecommended('@cf/moonshotai/kimi-k2.5')).toBe(false)
    })
  })

  describe('negatives', () => {
    it.each([
      'openai/gpt-6-luna-mini',
      'openai/gpt-6-luna-audio',
      'openai/gpt-6',
      'openai/gpt-6-luna-pro',
      'anthropic/claude-haiku-5',
      'anthropic/claude-haiku-5.5-thinking',
      'anthropic/claude-haiku-5.50',
      'anthropic/claude-sonnet-5.5',
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-flash-lite-image',
      'google/gemini-3.1-flash',
      'x-ai/grok-4.20-0309-reasoning',
      'x-ai/grok-4.20',
      'x-ai/grok-4.20-0309-non-reasoning-fast',
      'deepseek/deepseek-flash-lite',
      'deepseek/deepseek-chat',
      'moonshotai/kimi-k2.6-turbo',
      'moonshotai/kimi-k2',
      'moonshotai/kimi-k2-thinking',
      'qwen/qwen3.8-flash-omni',
      'qwen/qwen3.8-plus',
    ])('does not recommend the similar but different %s', (gatewayModelId) => {
      expect(isRecommended(gatewayModelId)).toBe(false)
    })

    it('does not match a recommended slug under the wrong vendor', () => {
      expect(isRecommended('openai/claude-haiku-5.5')).toBe(false)
      expect(isRecommended('google/gpt-6-luna')).toBe(false)
      expect(isRecommended('anthropic/kimi-k2.6')).toBe(false)
    })

    it('does not recommend unknown vendors or routers', () => {
      expect(isRecommended('mistralai/gpt-6-luna')).toBe(false)
      expect(isRecommended('meta-llama/llama-4-scout')).toBe(false)
      expect(isRecommended('openrouter/auto')).toBe(false)
      expect(isRecommended('~anthropic/claude-haiku-latest')).toBe(false)
      expect(isRecommended('~moonshotai/kimi-latest')).toBe(false)
    })

    it('does not recommend ids without a vendor segment', () => {
      expect(isRecommended('gpt-6-luna')).toBe(false)
      expect(isRecommended('kimi-k2.6')).toBe(false)
      expect(isRecommended('')).toBe(false)
      expect(isRecommended('openai/')).toBe(false)
    })

    it('recommends nothing when no direct model is flagged', () => {
      expect(isRecommendedGatewayModel('openai/gpt-6-luna', [])).toBe(false)
    })

    it('matches only the provider that owns the flagged model', () => {
      const openAiOnly = [{ providerId: 'openai', modelId: 'gpt-6-luna' }]

      expect(isRecommendedGatewayModel('openai/gpt-6-luna', openAiOnly))
        .toBe(true)
      expect(isRecommendedGatewayModel('qwen/qwen3.8-flash', openAiOnly))
        .toBe(false)
    })
  })
})
