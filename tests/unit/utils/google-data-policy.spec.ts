import { describe, expect, it } from 'vitest'
import { gatewayIds } from '#shared/utils/gateways'
import { providerMeta } from '#shared/utils/provider-meta'
import { providers } from '~~/providers'
import {
  GOOGLE_DATA_GATEWAY_RULES,
  GOOGLE_DATA_PROVIDER_RULES,
  GOOGLE_DATA_REFUSED_TOOL_RULES,
  GOOGLE_DATA_WORKERS_AI_RULE,
  GOOGLE_EXTERNAL_SOURCES,
  evaluateGoogleDataRoute,
  isGoogleExternalSource,
  mayReceiveGoogleData,
} from '#shared/utils/google-data-policy'

const allRules = [
  ...Object.values(GOOGLE_DATA_PROVIDER_RULES),
  ...Object.values(GOOGLE_DATA_GATEWAY_RULES),
  GOOGLE_DATA_WORKERS_AI_RULE,
  ...GOOGLE_DATA_REFUSED_TOOL_RULES,
]

describe('Google external sources', () => {
  it('has one value, google, as the pre-check says', () => {
    expect(GOOGLE_EXTERNAL_SOURCES).toEqual(['google'])
  })

  it('recognizes only listed values', () => {
    expect(isGoogleExternalSource('google')).toBe(true)
    expect(isGoogleExternalSource('google-drive')).toBe(false)
    expect(isGoogleExternalSource('')).toBe(false)
    expect(isGoogleExternalSource(null)).toBe(false)
    expect(isGoogleExternalSource(undefined)).toBe(false)
  })
})

describe('Google data rule table', () => {
  it('has a rule for every real provider and gateway id', () => {
    const providerIds = providers.map((provider) => {
      return provider.id
    })

    expect(Object.keys(GOOGLE_DATA_PROVIDER_RULES).sort())
      .toEqual([...providerIds].sort())
    expect(Object.keys(GOOGLE_DATA_GATEWAY_RULES).sort())
      .toEqual([...gatewayIds].sort())
  })

  it('keys every rule by its own id and kind', () => {
    for (const [key, entry] of Object.entries(GOOGLE_DATA_PROVIDER_RULES)) {
      expect(entry.id).toBe(key)
      expect(entry.kind).toBe('provider')
      expect(providerMeta[key]?.kind).toBe('provider')
    }

    for (const [key, entry] of Object.entries(GOOGLE_DATA_GATEWAY_RULES)) {
      expect(entry.id).toBe(key)
      expect(entry.kind).toBe('gateway')
      expect(providerMeta[key]?.kind).toBe('gateway')
    }
  })

  it('matches refused tool rules to real search and check ids', () => {
    for (const entry of GOOGLE_DATA_REFUSED_TOOL_RULES) {
      expect(entry.verdict).toBe('refused')
      expect(providerMeta[entry.id]?.kind).toBe(entry.kind === 'search'
        ? 'search'
        : 'memory-check')
    }
  })

  it('gives every rule a reason, a source and the 2026-11-07 date', () => {
    for (const entry of allRules) {
      expect(entry.reason.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.source, entry.id).toContain('docs/legal/prechecks/google.md')
      expect(entry.sourceDate, entry.id).toBe('2026-11-07')
    }
  })

  it('lists conditions exactly on conditional rules', () => {
    for (const entry of allRules) {
      if (entry.verdict === 'conditional') {
        expect(entry.conditions.length, entry.id).toBeGreaterThan(0)
      } else {
        expect(entry.conditions, entry.id).toEqual([])
      }
    }
  })

  it('refuses DeepSeek and Moonshot AI and allows the unconditional ones', () => {
    expect(GOOGLE_DATA_PROVIDER_RULES.deepseek.verdict).toBe('refused')
    expect(GOOGLE_DATA_PROVIDER_RULES.moonshotai.verdict).toBe('refused')
    expect(GOOGLE_DATA_PROVIDER_RULES.anthropic.verdict).toBe('allowed')
    expect(GOOGLE_DATA_PROVIDER_RULES.openai.verdict).toBe('allowed')
    expect(GOOGLE_DATA_PROVIDER_RULES.xai.verdict).toBe('allowed')
  })
})

describe('evaluateGoogleDataRoute', () => {
  it('allows unconditional direct providers', () => {
    for (const providerId of ['anthropic', 'openai', 'xai']) {
      expect(mayReceiveGoogleData({ providerId }), providerId).toBe(true)
    }
  })

  it('refuses DeepSeek and Moonshot AI even with every condition met', () => {
    const satisfiedConditions = [
      'gemini-paid-tier-confirmed',
      'alibaba-served-model',
      'zero-data-retention',
      'payload-logging-disabled',
    ] as const

    for (const providerId of ['deepseek', 'moonshotai']) {
      expect(evaluateGoogleDataRoute({ providerId, satisfiedConditions }))
        .toMatchObject({ allowed: false, reason: 'refused' })
    }
  })

  it('allows Gemini only once the paid tier is confirmed', () => {
    expect(evaluateGoogleDataRoute({ providerId: 'google' })).toEqual({
      allowed: false,
      reason: 'condition-unmet',
      recipientId: 'google',
      unmetConditions: ['gemini-paid-tier-confirmed'],
    })
    expect(mayReceiveGoogleData({
      providerId: 'google',
      satisfiedConditions: ['gemini-paid-tier-confirmed'],
    })).toBe(true)
  })

  it('allows Qwen only for models Alibaba serves itself', () => {
    expect(mayReceiveGoogleData({ providerId: 'qwen' })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'qwen',
      satisfiedConditions: ['alibaba-served-model'],
    })).toBe(true)
  })

  it('ignores conditions that belong to another recipient', () => {
    expect(mayReceiveGoogleData({
      providerId: 'google',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(false)
  })

  it('needs the gateway condition and an allowed upstream', () => {
    expect(mayReceiveGoogleData({
      providerId: 'anthropic',
      gatewayId: 'vercel',
    })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'anthropic',
      gatewayId: 'vercel',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(true)
    expect(mayReceiveGoogleData({
      providerId: 'deepseek',
      gatewayId: 'vercel',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(false)
  })

  it('applies each gateway\'s own condition', () => {
    expect(mayReceiveGoogleData({
      providerId: 'openai',
      gatewayId: 'openrouter',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(true)
    expect(mayReceiveGoogleData({
      providerId: 'openai',
      gatewayId: 'cloudflare',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'openai',
      gatewayId: 'cloudflare',
      satisfiedConditions: ['payload-logging-disabled'],
    })).toBe(true)
  })

  it('still needs the upstream condition behind an allowed gateway', () => {
    expect(evaluateGoogleDataRoute({
      providerId: 'google',
      gatewayId: 'vercel',
      satisfiedConditions: ['zero-data-retention'],
    })).toMatchObject({
      allowed: false,
      reason: 'condition-unmet',
      unmetConditions: ['gemini-paid-tier-confirmed'],
    })
  })

  it('maps known gateway vendor slugs to provider ids', () => {
    expect(mayReceiveGoogleData({
      providerId: 'x-ai',
      gatewayId: 'openrouter',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(true)
    expect(mayReceiveGoogleData({
      providerId: 'deepseek-ai',
      gatewayId: 'openrouter',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(false)
  })

  it('allows Workers AI only through the Cloudflare gateway', () => {
    expect(mayReceiveGoogleData({ providerId: 'workers-ai' })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'workers-ai',
      gatewayId: 'vercel',
      satisfiedConditions: ['zero-data-retention'],
    })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'workers-ai',
      gatewayId: 'cloudflare',
      satisfiedConditions: ['payload-logging-disabled'],
    })).toBe(true)
  })

  it('fails closed on unknown providers and gateways', () => {
    expect(evaluateGoogleDataRoute({ providerId: 'mistral' }))
      .toMatchObject({ allowed: false, reason: 'unknown-recipient' })
    expect(evaluateGoogleDataRoute({
      providerId: 'anthropic',
      gatewayId: 'litellm',
    })).toMatchObject({
      allowed: false,
      reason: 'unknown-recipient',
      recipientId: 'litellm',
    })
    expect(mayReceiveGoogleData({ providerId: 'constructor' })).toBe(false)
    expect(mayReceiveGoogleData({
      providerId: 'anthropic',
      gatewayId: 'toString',
    })).toBe(false)
  })

  it('refuses search and check recipients as providers', () => {
    for (const entry of GOOGLE_DATA_REFUSED_TOOL_RULES) {
      expect(mayReceiveGoogleData({ providerId: entry.id }), entry.id)
        .toBe(false)
    }
  })
})
