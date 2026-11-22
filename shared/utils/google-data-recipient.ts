import type { GatewayId } from '#shared/types/gateways.d'
import {
  GOOGLE_DATA_GATEWAY_RULES,
  GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID,
  evaluateGoogleDataRoute,
} from '#shared/utils/google-data-policy'
import type {
  GoogleDataCondition,
  GoogleDataDecision,
  GoogleDataRoute,
} from '#shared/utils/google-data-policy'

const WORKERS_AI_MODEL_PREFIXES = ['@cf/', '@hf/'] as const
const ALIBABA_SERVED_MODEL_PATTERN = /^(?:qwen|qwq|qvq)/i

export const GOOGLE_DATA_REFUSED_REASON = 'This provider may train on your '
  + 'Google data.'

export const GOOGLE_DATA_PAID_TIER_REASON = 'Confirm that your Gemini key is '
  + 'on a paid Google Cloud project to use it with Google data.'

export const GOOGLE_DATA_GATEWAY_CONDITION_REASON = 'This model is not '
  + 'allowed with Google data through a gateway.'

export const GOOGLE_DATA_UNKNOWN_REASON = 'This model has not been checked '
  + 'for Google data.'

export const GOOGLE_DATA_PAID_TIER_STATEMENT = 'This key is on a Google Cloud '
  + 'project with billing enabled'

/**
 * The model a chat would send to: a direct provider, or a model id routed
 * through a gateway.
 */
export interface GoogleDataRecipient {
  providerId?: string | null
  gatewayId?: string | null
  modelId: string
}

/**
 * Facts the caller verified. `geminiPaidTierConfirmed` comes from
 * `keys.paid_tier_confirmed_at` of the user's Gemini key.
 * `gatewaySafeguardsSent` is true only where the call actually sends the
 * gateway's zero-data-retention or no-payload-logging setting.
 */
export interface GoogleDataRecipientFacts {
  geminiPaidTierConfirmed?: boolean
  gatewaySafeguardsSent?: boolean
}

/**
 * The per-request setting Besidka sends to each gateway on a call that may
 * carry Google data, as the pre-check's allow-list asks.
 */
export const GOOGLE_DATA_GATEWAY_SAFEGUARDS: Readonly<
  Record<GatewayId, GoogleDataCondition>
> = {
  vercel: 'zero-data-retention',
  openrouter: 'zero-data-retention',
  cloudflare: 'payload-logging-disabled',
}

function isKnownGatewayId(gatewayId: string): gatewayId is GatewayId {
  return Object.hasOwn(GOOGLE_DATA_GATEWAY_RULES, gatewayId)
}

/**
 * The upstream provider of a gateway model id: `@cf/` and `@hf/` models run
 * on Cloudflare Workers AI, `vendor/model` names its vendor. Anything else
 * has no known upstream and is refused.
 */
export function googleDataUpstreamOf(modelId: string): string | null {
  const isWorkersAiModel = WORKERS_AI_MODEL_PREFIXES.some((prefix) => {
    return modelId.startsWith(prefix)
  })

  if (isWorkersAiModel) {
    return GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID
  }

  const separatorIndex = modelId.indexOf('/')

  if (separatorIndex <= 0) {
    return null
  }

  return modelId.slice(0, separatorIndex).toLowerCase()
}

/**
 * Whether a direct Qwen model is one Alibaba serves itself: every model in
 * the curated Qwen catalog is a Qwen, QwQ or QvQ model.
 */
export function isAlibabaServedQwenModel(modelId: string): boolean {
  return ALIBABA_SERVED_MODEL_PATTERN.test(modelId)
}

function directConditionsOf(
  providerId: string,
  modelId: string,
  facts: GoogleDataRecipientFacts,
): GoogleDataCondition[] {
  if (providerId === 'google' && facts.geminiPaidTierConfirmed === true) {
    return ['gemini-paid-tier-confirmed']
  }

  if (providerId === 'qwen' && isAlibabaServedQwenModel(modelId)) {
    return ['alibaba-served-model']
  }

  return []
}

/**
 * The route the allow-list judges. A gateway route never carries the direct
 * Gemini paid-tier confirmation or the Alibaba condition: neither can be
 * verified for a model a gateway serves.
 */
export function googleDataRouteOf(
  recipient: GoogleDataRecipient,
  facts: GoogleDataRecipientFacts = {},
): GoogleDataRoute {
  if (recipient.gatewayId) {
    const satisfiedConditions: GoogleDataCondition[]
      = facts.gatewaySafeguardsSent === true
        && isKnownGatewayId(recipient.gatewayId)
        ? [GOOGLE_DATA_GATEWAY_SAFEGUARDS[recipient.gatewayId]]
        : []

    return {
      providerId: googleDataUpstreamOf(recipient.modelId) ?? '',
      gatewayId: recipient.gatewayId,
      satisfiedConditions,
    }
  }

  const providerId = recipient.providerId ?? ''

  return {
    providerId,
    satisfiedConditions: directConditionsOf(
      providerId,
      recipient.modelId,
      facts,
    ),
  }
}

export function decideGoogleDataRecipient(
  recipient: GoogleDataRecipient,
  facts: GoogleDataRecipientFacts = {},
): GoogleDataDecision {
  return evaluateGoogleDataRoute(googleDataRouteOf(recipient, facts))
}

/**
 * One short sentence for a refused recipient, shown in the model picker and
 * in the error of a refused send. Empty for an allowed one.
 */
export function googleDataRefusalReason(
  decision: GoogleDataDecision,
  recipient: GoogleDataRecipient,
): string {
  if (decision.allowed) {
    return ''
  }

  if (decision.reason === 'refused') {
    return GOOGLE_DATA_REFUSED_REASON
  }

  if (decision.reason !== 'condition-unmet') {
    return GOOGLE_DATA_UNKNOWN_REASON
  }

  if (recipient.gatewayId) {
    return GOOGLE_DATA_GATEWAY_CONDITION_REASON
  }

  return decision.unmetConditions.includes('gemini-paid-tier-confirmed')
    ? GOOGLE_DATA_PAID_TIER_REASON
    : GOOGLE_DATA_UNKNOWN_REASON
}

/**
 * What the user can do about a refused recipient.
 */
export function googleDataRefusalFix(
  decision: GoogleDataDecision,
  recipient: GoogleDataRecipient,
): string {
  const canConfirmPaidTier = !recipient.gatewayId
    && decision.unmetConditions.includes('gemini-paid-tier-confirmed')

  return canConfirmPaidTier
    ? 'Confirm the paid tier on your Gemini key in Profile → API Keys, or '
    + 'pick another model for this chat.'
    : 'Pick a model from Anthropic, OpenAI or xAI for this chat, or start a '
      + 'new chat.'
}
