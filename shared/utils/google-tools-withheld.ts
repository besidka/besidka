import type { SupportedProviderId } from '#shared/types/providers.d'
import { GOOGLE_DATA_PROVIDER_RULES } from '#shared/utils/google-data-policy'
import type { GoogleDataRule } from '#shared/utils/google-data-policy'
import { providerMeta } from '#shared/utils/provider-meta'

export const GOOGLE_TOOLS_WITHHELD_PART_TYPE = 'data-google-tools-withheld'

export const GOOGLE_TOOLS_WITHHELD_REASONS = [
  'model_may_not_receive_google_data',
  'provider_tool_not_removable',
] as const

export type GoogleToolsWithheldReason
  = typeof GOOGLE_TOOLS_WITHHELD_REASONS[number]

export const GOOGLE_TOOLS_WITHHELD_KEYS_PATH = '/profile/keys?provider=google'

export const GOOGLE_TOOLS_OPEN_KEYS_LABEL = 'Open API Keys'

export const GOOGLE_TOOLS_MODEL_REFUSED_INSTRUCTION = 'The user has Google '
  + 'services connected in Besidka (Drive, Gmail, Calendar), but they are '
  + 'not available to this model. If the request needs them, say so and '
  + 'suggest switching to another model; do not suggest connecting a '
  + 'service.'

export interface GoogleToolsWithheldNote {
  summary: string
  detail: string
  linkLabel: string | null
}

export const GOOGLE_TOOLS_WITHHELD_NOTES: Record<
  GoogleToolsWithheldReason,
  GoogleToolsWithheldNote
> = {
  model_may_not_receive_google_data: {
    summary: 'Google tools were not offered to this model.',
    detail: 'Besidka does not send Google data to a model that may use it '
      + 'for training. Pick another model, or confirm on the API Keys page '
      + 'that your Gemini key is a paid one.',
    linkLabel: GOOGLE_TOOLS_OPEN_KEYS_LABEL,
  },
  provider_tool_not_removable: {
    summary: 'Google tools were not offered with a built-in provider tool.',
    detail: 'Turn off the provider\'s built-in tool for this message (web '
      + 'search or Run code), or ask again after a Google file is in the '
      + 'chat.',
    linkLabel: null,
  },
}

export const GOOGLE_TOOLS_NEUTRAL_REFUSED_DETAIL = 'Besidka does not send '
  + 'Google data to a model that may use it for training. Pick another '
  + 'model.'

export interface GoogleToolsRecipientHint {
  providerId?: string | null
  isGateway?: boolean
}

export function findGoogleProviderRule(
  providerId: string | null | undefined,
): GoogleDataRule | null {
  if (!providerId || !Object.hasOwn(GOOGLE_DATA_PROVIDER_RULES, providerId)) {
    return null
  }

  return GOOGLE_DATA_PROVIDER_RULES[providerId as SupportedProviderId]
}

export function googleProviderNeedsPaidTier(
  providerId: string | null | undefined,
): boolean {
  return findGoogleProviderRule(providerId)
    ?.conditions.includes('gemini-paid-tier-confirmed') === true
}

function getProviderDisplayName(providerId: string): string {
  const meta = providerMeta[providerId]

  return meta?.shortLabel ?? meta?.label ?? providerId
}

function describeAllowedAlternatives(): string {
  const rules = Object.values(GOOGLE_DATA_PROVIDER_RULES)
  const allowedNames = rules
    .filter(rule => rule.verdict === 'allowed')
    .map(rule => getProviderDisplayName(rule.id))
  const hasPaidTierProvider = rules.some((rule) => {
    return rule.conditions.includes('gemini-paid-tier-confirmed')
  })

  return hasPaidTierProvider
    ? `${allowedNames.join(', ')} or Gemini on a paid key`
    : allowedNames.join(' or ')
}

/**
 * The note for a refused recipient, worded for the recipient's own verdict in
 * the Google data allow-list (`GOOGLE_DATA_PROVIDER_RULES`). Only a Gemini
 * model keeps the paid-tier wording and the API Keys link, because the
 * confirmation on that page lifts the refusal for Gemini and for nothing
 * else. A provider the list refuses (its API terms allow training on inputs)
 * has no route, so it gets no link. A provider the list allows only on
 * models its vendor serves itself says so. A gateway keeps the generic
 * wording, and anything unresolved (a past message whose model is unknown)
 * gets a neutral text without a link.
 */
export function getGoogleToolsWithheldNote(
  reason: GoogleToolsWithheldReason,
  recipient: GoogleToolsRecipientHint = {},
): GoogleToolsWithheldNote {
  const note = GOOGLE_TOOLS_WITHHELD_NOTES[reason]

  if (
    reason !== 'model_may_not_receive_google_data'
    || recipient.isGateway === true
  ) {
    return note
  }

  const rule = findGoogleProviderRule(recipient.providerId)
  const neutralNote: GoogleToolsWithheldNote = {
    summary: note.summary,
    detail: GOOGLE_TOOLS_NEUTRAL_REFUSED_DETAIL,
    linkLabel: null,
  }

  if (!rule) {
    return neutralNote
  }

  if (googleProviderNeedsPaidTier(rule.id)) {
    return note
  }

  const providerName = getProviderDisplayName(rule.id)

  if (rule.verdict === 'refused') {
    return {
      summary: note.summary,
      detail: `${providerName} may use API inputs for training, so Besidka `
        + 'does not send Google data to it. Pick '
        + `${describeAllowedAlternatives()}.`,
      linkLabel: null,
    }
  }

  if (rule.conditions.includes('alibaba-served-model')) {
    return {
      summary: note.summary,
      detail: `${providerName} is allowed for Google data only on models `
        + 'Alibaba serves itself, because Alibaba does not train on inputs '
        + 'for those. This model is served by another vendor, whose terms '
        + 'apply, so Besidka does not send Google data to it. Pick another '
        + 'model.',
      linkLabel: null,
    }
  }

  return neutralNote
}

/**
 * The one part a send writes on the assistant message when it offered no
 * Google tool for a reason the user can act on. It holds only the reason
 * code: the texts live in `GOOGLE_TOOLS_WITHHELD_NOTES`, so nothing the
 * model or the server wrote is ever rendered, and it never reaches a model.
 */
export interface GoogleToolsWithheldPart {
  type: typeof GOOGLE_TOOLS_WITHHELD_PART_TYPE
  data: { reason: GoogleToolsWithheldReason }
}

export function isGoogleToolsWithheldReason(
  value: unknown,
): value is GoogleToolsWithheldReason {
  return typeof value === 'string'
    && (GOOGLE_TOOLS_WITHHELD_REASONS as readonly string[]).includes(value)
}

export function createGoogleToolsWithheldPart(
  reason: GoogleToolsWithheldReason,
): GoogleToolsWithheldPart {
  return {
    type: GOOGLE_TOOLS_WITHHELD_PART_TYPE,
    data: { reason },
  }
}

export function getGoogleToolsWithheldReason(
  message: { parts?: readonly unknown[] },
): GoogleToolsWithheldReason | null {
  for (const part of message.parts ?? []) {
    if (
      typeof part !== 'object'
      || part === null
      || (part as { type?: unknown }).type !== GOOGLE_TOOLS_WITHHELD_PART_TYPE
    ) {
      continue
    }

    const reason = (part as { data?: { reason?: unknown } }).data?.reason

    if (isGoogleToolsWithheldReason(reason)) {
      return reason
    }
  }

  return null
}
