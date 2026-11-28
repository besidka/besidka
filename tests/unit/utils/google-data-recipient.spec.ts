import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DATA_GATEWAY_CONDITION_REASON,
  GOOGLE_DATA_PAID_TIER_REASON,
  GOOGLE_DATA_REFUSED_REASON,
  GOOGLE_DATA_SELF_SEARCH_REASON,
  GOOGLE_DATA_UNKNOWN_REASON,
  decideGoogleDataRecipient,
  googleDataRefusalFix,
  googleDataRefusalReason,
  googleDataRouteOf,
  googleDataUpstreamOf,
  isAlibabaServedQwenModel,
  isSelfSearchingModel,
} from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'

function reasonOf(
  recipient: GoogleDataRecipient,
  facts: Parameters<typeof decideGoogleDataRecipient>[1] = {},
) {
  return googleDataRefusalReason(
    decideGoogleDataRecipient(recipient, facts),
    recipient,
  )
}

describe('googleDataUpstreamOf', () => {
  it('maps Workers AI model ids to the workers-ai upstream', () => {
    expect(googleDataUpstreamOf('@cf/meta/llama-3.3-70b')).toBe('workers-ai')
    expect(googleDataUpstreamOf('@hf/thebloke/model')).toBe('workers-ai')
  })

  it('takes the vendor of a vendor/model id', () => {
    expect(googleDataUpstreamOf('anthropic/claude-opus-5')).toBe('anthropic')
    expect(googleDataUpstreamOf('OpenAI/gpt-5')).toBe('openai')
  })

  it('has no upstream for an id without a vendor', () => {
    expect(googleDataUpstreamOf('llama-3.3-70b')).toBeNull()
    expect(googleDataUpstreamOf('/gpt-5')).toBeNull()
  })
})

describe('isAlibabaServedQwenModel', () => {
  it('accepts the Qwen family Alibaba serves', () => {
    expect(isAlibabaServedQwenModel('qwen3-max')).toBe(true)
    expect(isAlibabaServedQwenModel('qwq-plus')).toBe(true)
    expect(isAlibabaServedQwenModel('qvq-max')).toBe(true)
  })

  it('refuses a third-party vendor model', () => {
    expect(isAlibabaServedQwenModel('deepseek-v3')).toBe(false)
    expect(isAlibabaServedQwenModel('kimi-k2')).toBe(false)
  })
})

describe('decideGoogleDataRecipient', () => {
  it('allows a provider whose API terms exclude training', () => {
    for (const providerId of ['anthropic', 'openai', 'xai']) {
      expect(decideGoogleDataRecipient({
        providerId,
        modelId: 'model',
      })).toMatchObject({ allowed: true, reason: 'allowed' })
    }
  })

  it('allows Gemini only with the paid tier confirmed', () => {
    const recipient = { providerId: 'google', modelId: 'gemini-3-pro' }

    expect(decideGoogleDataRecipient(recipient, {
      geminiPaidTierConfirmed: true,
    }).allowed).toBe(true)
    expect(decideGoogleDataRecipient(recipient)).toMatchObject({
      allowed: false,
      reason: 'condition-unmet',
      unmetConditions: ['gemini-paid-tier-confirmed'],
    })
    expect(reasonOf(recipient)).toBe(GOOGLE_DATA_PAID_TIER_REASON)
  })

  it('allows a direct Qwen model Alibaba serves itself', () => {
    expect(decideGoogleDataRecipient({
      providerId: 'qwen',
      modelId: 'qwen3-max',
    }).allowed).toBe(true)
    expect(decideGoogleDataRecipient({
      providerId: 'qwen',
      modelId: 'vendor-model',
    })).toMatchObject({
      allowed: false,
      reason: 'condition-unmet',
      unmetConditions: ['alibaba-served-model'],
    })
  })

  it('refuses DeepSeek and Moonshot AI', () => {
    for (const providerId of ['deepseek', 'moonshotai']) {
      const recipient = { providerId, modelId: 'model' }

      expect(decideGoogleDataRecipient(recipient)).toMatchObject({
        allowed: false,
        reason: 'refused',
      })
      expect(reasonOf(recipient)).toBe(GOOGLE_DATA_REFUSED_REASON)
    }
  })

  it('refuses an unknown provider', () => {
    const recipient = { providerId: 'mistral', modelId: 'large' }

    expect(decideGoogleDataRecipient(recipient)).toMatchObject({
      allowed: false,
      reason: 'unknown-recipient',
    })
    expect(reasonOf(recipient)).toBe(GOOGLE_DATA_UNKNOWN_REASON)
  })

  it('refuses a recipient with no provider at all', () => {
    expect(decideGoogleDataRecipient({ modelId: 'x' }).allowed).toBe(false)
  })

  describe('gateways', () => {
    it('allows an allowed upstream only when the safeguard is sent', () => {
      for (const gatewayId of ['vercel', 'openrouter']) {
        const recipient = {
          gatewayId,
          modelId: 'anthropic/claude-opus-5',
        }

        expect(decideGoogleDataRecipient(recipient, {
          gatewaySafeguardsSent: true,
        }).allowed).toBe(true)
        expect(decideGoogleDataRecipient(recipient)).toMatchObject({
          allowed: false,
          unmetConditions: ['zero-data-retention'],
        })
      }

      expect(googleDataRouteOf({
        gatewayId: 'cloudflare',
        modelId: '@cf/meta/llama',
      }, { gatewaySafeguardsSent: true }).satisfiedConditions)
        .toEqual(['payload-logging-disabled'])
    })

    it('allows Workers AI only through the Cloudflare gateway', () => {
      expect(decideGoogleDataRecipient({
        gatewayId: 'cloudflare',
        modelId: '@cf/meta/llama-3.3-70b',
      }, { gatewaySafeguardsSent: true }).allowed).toBe(true)
      expect(decideGoogleDataRecipient({
        gatewayId: 'openrouter',
        modelId: '@cf/meta/llama-3.3-70b',
      }, { gatewaySafeguardsSent: true }).allowed).toBe(false)
    })

    it('refuses a refused upstream behind any gateway', () => {
      expect(decideGoogleDataRecipient({
        gatewayId: 'openrouter',
        modelId: 'deepseek/deepseek-chat',
      }, { gatewaySafeguardsSent: true })).toMatchObject({
        allowed: false,
        reason: 'refused',
      })
    })

    it('never carries the Gemini or Alibaba condition onto a gateway', () => {
      const gemini = { gatewayId: 'vercel', modelId: 'google/gemini-3-pro' }

      expect(decideGoogleDataRecipient(gemini, {
        gatewaySafeguardsSent: true,
        geminiPaidTierConfirmed: true,
      })).toMatchObject({
        allowed: false,
        unmetConditions: ['gemini-paid-tier-confirmed'],
      })
      expect(reasonOf(gemini, { gatewaySafeguardsSent: true }))
        .toBe(GOOGLE_DATA_GATEWAY_CONDITION_REASON)
      expect(decideGoogleDataRecipient({
        gatewayId: 'openrouter',
        modelId: 'qwen/qwen3-max',
      }, { gatewaySafeguardsSent: true }).allowed).toBe(false)
    })

    it('refuses an unknown gateway or an id without a vendor', () => {
      expect(decideGoogleDataRecipient({
        gatewayId: 'litellm',
        modelId: 'anthropic/claude',
      }, { gatewaySafeguardsSent: true }).reason).toBe('unknown-recipient')
      expect(decideGoogleDataRecipient({
        gatewayId: 'vercel',
        modelId: 'claude-opus-5',
      }, { gatewaySafeguardsSent: true }).reason).toBe('unknown-recipient')
    })
  })
})

describe('models that search the web by themselves', () => {
  const searching: Array<[string, GoogleDataRecipient]> = [
    ['OpenRouter :online', {
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5:online',
    }],
    ['OpenRouter :online, any case', {
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5:ONLINE',
    }],
    ['OpenAI -search-preview', {
      providerId: 'openai',
      modelId: 'gpt-4o-search-preview',
    }],
    ['OpenAI mini -search-preview with a date', {
      providerId: 'openai',
      modelId: 'gpt-4o-mini-search-preview-2025-03-11',
    }],
    ['OpenAI -search-api', {
      providerId: 'openai',
      modelId: 'gpt-5-search-api',
    }],
    ['gateway -search-preview', {
      gatewayId: 'vercel',
      modelId: 'openai/gpt-4o-search-preview',
    }],
    ['bare sonar', { providerId: 'openai', modelId: 'sonar' }],
    ['Perplexity sonar-pro', {
      gatewayId: 'openrouter',
      modelId: 'perplexity/sonar-pro',
    }],
    ['Perplexity sonar-reasoning-pro', {
      gatewayId: 'vercel',
      modelId: 'perplexity/sonar-reasoning-pro',
    }],
  ]

  it.each(searching)('refuses %s with the self-search reason', (
    _label,
    recipient,
  ) => {
    const decision = decideGoogleDataRecipient(recipient, {
      gatewaySafeguardsSent: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('searches-by-itself')
    expect(googleDataRefusalReason(decision, recipient))
      .toBe(GOOGLE_DATA_SELF_SEARCH_REASON)
    expect(googleDataRefusalFix(decision, recipient))
      .toContain('without its online or search variant')
    expect(isSelfSearchingModel(recipient.modelId)).toBe(true)
  })

  it.each([
    'claude-sonnet-5',
    'anthropic/claude-sonnet-4-5',
    'gpt-5',
    'openai/gpt-5-mini',
    'online-model-v1',
    'research-search-tool',
    'grok-4',
  ])('leaves %s alone', (modelId) => {
    expect(isSelfSearchingModel(modelId)).toBe(false)
  })

  it('does not cover a self-searching model under another name', () => {
    expect(isSelfSearchingModel('perplexity/llama-3.1-70b-instruct'))
      .toBe(false)
  })
})

describe('googleDataRefusalReason and googleDataRefusalFix', () => {
  it('is empty for an allowed recipient', () => {
    expect(reasonOf({ providerId: 'openai', modelId: 'gpt-5' })).toBe('')
  })

  it('points a Gemini user at the paid-tier confirmation', () => {
    const recipient = { providerId: 'google', modelId: 'gemini-3-pro' }

    expect(googleDataRefusalFix(
      decideGoogleDataRecipient(recipient),
      recipient,
    )).toContain('Confirm the paid tier')
  })

  it('points everyone else at another model', () => {
    const recipient = { providerId: 'deepseek', modelId: 'deepseek-chat' }

    expect(googleDataRefusalFix(
      decideGoogleDataRecipient(recipient),
      recipient,
    )).toContain('Pick a model')
  })
})
