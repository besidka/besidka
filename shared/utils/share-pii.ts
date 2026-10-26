import type {
  SharePiiKind,
  SharePiiWarning,
} from '#shared/types/share-pii.d'

export const SHARE_PII_KIND_LABELS: Record<SharePiiKind, string> = {
  'email': 'email',
  'phone': 'phone',
  'iban': 'bank account',
  'national-id': 'national ID',
  'tax-id': 'tax ID',
  'payment-card': 'card number',
  'passport': 'passport',
  'personal-data': 'personal details',
}

export const SHARE_PII_MAX_LISTED_KINDS = 3

export const SHARE_PII_GENERIC_REMINDER
  = 'Check the chat for personal data before sharing.'

/**
 * The kinds named in the share warning: each label once, in the order the
 * check found them, with the AI-only "personal details" label left out when
 * a more specific one is already listed.
 */
export function describeSharePiiKinds(
  warnings: SharePiiWarning[],
): { labels: string[], hasMore: boolean } {
  const specificKinds = warnings
    .map(warning => warning.kind)
    .filter(kind => kind !== 'personal-data')
  const kinds = specificKinds.length > 0
    ? specificKinds
    : warnings.map(warning => warning.kind)
  const labels = [...new Set(kinds.map(kind => SHARE_PII_KIND_LABELS[kind]))]

  return {
    labels: labels.slice(0, SHARE_PII_MAX_LISTED_KINDS),
    hasMore: labels.length > SHARE_PII_MAX_LISTED_KINDS,
  }
}
