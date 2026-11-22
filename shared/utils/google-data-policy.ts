import type { GatewayId } from '#shared/types/gateways.d'
import type { SupportedProviderId } from '#shared/types/providers.d'

export const GOOGLE_EXTERNAL_SOURCES = ['google'] as const

export type GoogleExternalSource = typeof GOOGLE_EXTERNAL_SOURCES[number]

export const GOOGLE_DATA_POLICY_SOURCE_DATE = '2026-11-07'

export type GoogleDataVerdict = 'allowed' | 'conditional' | 'refused'

export type GoogleDataCondition
  = | 'gemini-paid-tier-confirmed'
    | 'alibaba-served-model'
    | 'zero-data-retention'
    | 'payload-logging-disabled'

export type GoogleDataRecipientKind
  = 'provider' | 'gateway' | 'upstream' | 'search' | 'memory-check'

export interface GoogleDataRule {
  id: string
  kind: GoogleDataRecipientKind
  verdict: GoogleDataVerdict
  conditions: readonly GoogleDataCondition[]
  reason: string
  source: string
  sourceDate: string
}

const PROVIDER_SOURCE
  = 'docs/legal/prechecks/google.md, "Provider allow-list for Google data"'

function rule(
  input: Omit<GoogleDataRule, 'conditions' | 'source' | 'sourceDate'>
    & Partial<Pick<GoogleDataRule, 'conditions' | 'source'>>,
): GoogleDataRule {
  return {
    conditions: [],
    source: PROVIDER_SOURCE,
    ...input,
    sourceDate: GOOGLE_DATA_POLICY_SOURCE_DATE,
  }
}

export const GOOGLE_DATA_PROVIDER_RULES: Readonly<
  Record<SupportedProviderId, GoogleDataRule>
> = {
  anthropic: rule({
    id: 'anthropic',
    kind: 'provider',
    verdict: 'allowed',
    reason: 'API inputs are not used for training by default.',
  }),
  openai: rule({
    id: 'openai',
    kind: 'provider',
    verdict: 'allowed',
    reason: 'API inputs are not used for training since 2023-03-01.',
  }),
  google: rule({
    id: 'google',
    kind: 'provider',
    verdict: 'conditional',
    conditions: ['gemini-paid-tier-confirmed'],
    reason: 'Unpaid Gemini API traffic is used for training with human '
      + 'review. Allowed only on a key the user confirmed is on a Google '
      + 'Cloud project with billing enabled.',
  }),
  xai: rule({
    id: 'xai',
    kind: 'provider',
    verdict: 'allowed',
    reason: 'No training without explicit permission. Which terms bind a '
      + 'self-serve key is unverified.',
  }),
  deepseek: rule({
    id: 'deepseek',
    kind: 'provider',
    verdict: 'refused',
    reason: 'No no-training promise for API traffic; the privacy policy '
      + 'lists training on inputs with an opt-out.',
  }),
  moonshotai: rule({
    id: 'moonshotai',
    kind: 'provider',
    verdict: 'refused',
    reason: 'Trains on API inputs by default.',
  }),
  qwen: rule({
    id: 'qwen',
    kind: 'provider',
    verdict: 'conditional',
    conditions: ['alibaba-served-model'],
    reason: 'Alibaba Model Studio (international) does not train on inputs '
      + 'for models Alibaba serves itself. Third-party vendor models follow '
      + 'the vendor\'s terms.',
  }),
}

export const GOOGLE_DATA_GATEWAY_RULES: Readonly<
  Record<GatewayId, GoogleDataRule>
> = {
  vercel: rule({
    id: 'vercel',
    kind: 'gateway',
    verdict: 'conditional',
    conditions: ['zero-data-retention'],
    reason: 'Allowed with providerOptions.gateway.zeroDataRetention sent as '
      + 'true and an allowed upstream provider. A 403 or zdr_not_attested '
      + 'blocks the send.',
  }),
  openrouter: rule({
    id: 'openrouter',
    kind: 'gateway',
    verdict: 'conditional',
    conditions: ['zero-data-retention'],
    reason: 'Allowed with zero-data-retention endpoints requested in the '
      + 'provider preferences and an allowed upstream provider.',
  }),
  cloudflare: rule({
    id: 'cloudflare',
    kind: 'gateway',
    verdict: 'conditional',
    conditions: ['payload-logging-disabled'],
    reason: 'AI Gateway logs payloads by default. Allowed with '
      + 'cf-aig-collect-log-payload set to false and an allowed upstream '
      + 'provider.',
  }),
}

export const GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID = 'workers-ai'

export const GOOGLE_DATA_WORKERS_AI_RULE: GoogleDataRule = rule({
  id: GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID,
  kind: 'upstream',
  verdict: 'allowed',
  reason: 'Cloudflare Workers AI does not train on inputs. Reached only '
    + 'through the Cloudflare gateway, whose own condition still applies.',
})

const TOOL_SOURCE
  = 'docs/legal/prechecks/google.md, question table row 2'

export const GOOGLE_DATA_REFUSED_TOOL_RULES: readonly GoogleDataRule[] = [
  rule({
    id: 'brave',
    kind: 'search',
    verdict: 'refused',
    reason: 'Brave searches are skipped in chats that carry Google data '
      + 'until the owner checks their terms.',
    source: TOOL_SOURCE,
  }),
  rule({
    id: 'exa',
    kind: 'search',
    verdict: 'refused',
    reason: 'Exa searches are skipped in chats that carry Google data '
      + 'until the owner checks their terms.',
    source: TOOL_SOURCE,
  }),
  rule({
    id: 'typesafe',
    kind: 'memory-check',
    verdict: 'refused',
    reason: 'TypeSafe AI checks are skipped in chats that carry Google data '
      + 'until the owner checks their terms.',
    source: TOOL_SOURCE,
  }),
]

export const GOOGLE_DATA_UPSTREAM_ALIASES: Readonly<Record<string, string>> = {
  'x-ai': 'xai',
  'deepseek-ai': 'deepseek',
}

export interface GoogleDataRoute {
  providerId: string
  gatewayId?: string
  satisfiedConditions?: readonly GoogleDataCondition[]
}

export type GoogleDataDecisionReason
  = | 'allowed'
    | 'refused'
    | 'condition-unmet'
    | 'unknown-recipient'
    | 'searches-by-itself'

export interface GoogleDataDecision {
  allowed: boolean
  reason: GoogleDataDecisionReason
  recipientId: string
  unmetConditions: GoogleDataCondition[]
}

function findProviderRule(providerId: string): GoogleDataRule | undefined {
  if (providerId === GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID) {
    return GOOGLE_DATA_WORKERS_AI_RULE
  }

  const canonicalId = GOOGLE_DATA_UPSTREAM_ALIASES[providerId] ?? providerId

  if (!Object.hasOwn(GOOGLE_DATA_PROVIDER_RULES, canonicalId)) {
    return undefined
  }

  return GOOGLE_DATA_PROVIDER_RULES[canonicalId as SupportedProviderId]
}

function findGatewayRule(gatewayId: string): GoogleDataRule | undefined {
  if (!Object.hasOwn(GOOGLE_DATA_GATEWAY_RULES, gatewayId)) {
    return undefined
  }

  return GOOGLE_DATA_GATEWAY_RULES[gatewayId as GatewayId]
}

function decideRule(
  recipientRule: GoogleDataRule,
  satisfiedConditions: readonly GoogleDataCondition[],
): GoogleDataDecision {
  if (recipientRule.verdict === 'refused') {
    return {
      allowed: false,
      reason: 'refused',
      recipientId: recipientRule.id,
      unmetConditions: [],
    }
  }

  const unmetConditions = recipientRule.conditions.filter((condition) => {
    return !satisfiedConditions.includes(condition)
  })

  if (unmetConditions.length > 0) {
    return {
      allowed: false,
      reason: 'condition-unmet',
      recipientId: recipientRule.id,
      unmetConditions,
    }
  }

  return {
    allowed: true,
    reason: 'allowed',
    recipientId: recipientRule.id,
    unmetConditions: [],
  }
}

export function evaluateGoogleDataRoute(
  route: GoogleDataRoute,
): GoogleDataDecision {
  const satisfiedConditions = route.satisfiedConditions ?? []

  if (route.gatewayId !== undefined) {
    const gatewayRule = findGatewayRule(route.gatewayId)

    if (!gatewayRule) {
      return {
        allowed: false,
        reason: 'unknown-recipient',
        recipientId: route.gatewayId,
        unmetConditions: [],
      }
    }

    const gatewayDecision = decideRule(gatewayRule, satisfiedConditions)

    if (!gatewayDecision.allowed) {
      return gatewayDecision
    }
  }

  const providerRule = findProviderRule(route.providerId)
  const isUnroutableWorkersAi
    = route.providerId === GOOGLE_DATA_WORKERS_AI_UPSTREAM_ID
      && route.gatewayId !== 'cloudflare'

  if (!providerRule || isUnroutableWorkersAi) {
    return {
      allowed: false,
      reason: 'unknown-recipient',
      recipientId: route.providerId,
      unmetConditions: [],
    }
  }

  return decideRule(providerRule, satisfiedConditions)
}

export function mayReceiveGoogleData(route: GoogleDataRoute): boolean {
  return evaluateGoogleDataRoute(route).allowed
}

export function isGoogleExternalSource(
  value: string | null | undefined,
): value is GoogleExternalSource {
  return GOOGLE_EXTERNAL_SOURCES.some((source) => {
    return source === value
  })
}
