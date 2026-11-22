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

export const GOOGLE_DATA_SELF_SEARCH_REASON = 'This model searches the web '
  + 'by itself, so your Google data could reach a search service.'

/**
 * The model ids that search the web on their own, whatever tools a send
 * declares, so the whole conversation (and the Google data in it) can reach
 * a search backend. The catalogs carry no flag for this (`supportsWebSearch`
 * only says a search tool can be switched on, and a flagged chat removes
 * those tools), so the documented id patterns are the check:
 * - a trailing `:online`, OpenRouter's shortcut that adds its web plugin to
 *   any model (`openai/gpt-5:online`);
 * - `-search-preview` and `-search-api` in an id, OpenAI's search models
 *   (`gpt-4o-search-preview`, `openai/gpt-4o-mini-search-preview`);
 * - `sonar` as a word of the id, Perplexity's search models (`sonar`,
 *   `perplexity/sonar-pro`, `sonar-reasoning-pro`; the word match leaves
 *   `claude-sonnet` alone).
 * A self-searching model under another name is not covered.
 */
const SELF_SEARCHING_MODEL_PATTERNS: readonly RegExp[] = [
  /:online$/i,
  /-search-(?:preview|api)(?:-|$)/i,
  /(?:^|[/:._-])sonar(?:$|[:._-])/i,
]

export function isSelfSearchingModel(modelId: string): boolean {
  return SELF_SEARCHING_MODEL_PATTERNS.some((pattern) => {
    return pattern.test(modelId)
  })
}

export const GOOGLE_DATA_PAID_TIER_STATEMENT = 'This key is on a Google Cloud '
  + 'project with billing enabled'

/**
 * A transient stream chunk the send route writes when the chat holds Google
 * data: at the start of a send in a flagged chat, and after the first step
 * with a Google result. The client then gates the model picker without a
 * reload. Never stored in `messages.parts`.
 */
export const CHAT_GOOGLE_DATA_PART_TYPE = 'data-google-data'

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
  if (isSelfSearchingModel(recipient.modelId)) {
    return {
      allowed: false,
      reason: 'searches-by-itself',
      recipientId: recipient.modelId,
      unmetConditions: [],
    }
  }

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

  if (decision.reason === 'searches-by-itself') {
    return GOOGLE_DATA_SELF_SEARCH_REASON
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
  if (decision.reason === 'searches-by-itself') {
    return 'Pick the same model without its online or search variant, or a '
      + 'model from Anthropic, OpenAI or xAI that does not search by itself, '
      + 'or start a new chat.'
  }

  const canConfirmPaidTier = !recipient.gatewayId
    && decision.unmetConditions.includes('gemini-paid-tier-confirmed')

  return canConfirmPaidTier
    ? 'Confirm the paid tier on your Gemini key in Profile → API Keys, or '
    + 'pick another model for this chat.'
    : 'Pick a model from Anthropic, OpenAI or xAI for this chat, or start a '
      + 'new chat.'
}
