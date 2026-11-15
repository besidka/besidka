import {
  CONNECTOR_SLUG_MAX_LENGTH,
  CONNECTOR_SLUG_PATTERN,
} from '#shared/utils/connectors-policy'

const FALLBACK_SLUG = 'connector'
const SHORT_LABEL_MAX_LENGTH = 3

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function truncateSlug(value: string, maxLength: number): string {
  return value.slice(0, maxLength).replace(/-+$/, '')
}

export function isValidConnectorSlug(value: string): boolean {
  return CONNECTOR_SLUG_PATTERN.test(value)
}

/**
 * Base slug for a connector host: the second-to-last label, or the
 * third-to-last when the second-to-last has three characters or fewer and
 * another label exists (`mcp.example.co.uk` gives `example`).
 */
export function deriveConnectorSlugBase(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean)
  const secondToLast = labels.at(-2)
  const thirdToLast = labels.at(-3)
  let label = secondToLast ?? labels[0] ?? ''

  if (
    secondToLast !== undefined
    && secondToLast.length <= SHORT_LABEL_MAX_LENGTH
    && thirdToLast !== undefined
  ) {
    label = thirdToLast
  }

  const slug = truncateSlug(
    sanitizeSlug(label),
    CONNECTOR_SLUG_MAX_LENGTH,
  )

  return slug || FALLBACK_SLUG
}

/**
 * First free slug for a base: the base itself, then `-2`, `-3` and so on,
 * with the base cut so the suffixed slug still fits the length limit.
 */
export function allocateConnectorSlug(
  base: string,
  takenSlugs: ReadonlySet<string>,
): string {
  const cleanBase = truncateSlug(
    sanitizeSlug(base),
    CONNECTOR_SLUG_MAX_LENGTH,
  ) || FALLBACK_SLUG

  if (!takenSlugs.has(cleanBase)) {
    return cleanBase
  }

  for (let counter = 2; ; counter++) {
    const suffix = `-${counter}`
    const candidate = truncateSlug(
      cleanBase,
      CONNECTOR_SLUG_MAX_LENGTH - suffix.length,
    ) + suffix

    if (!takenSlugs.has(candidate)) {
      return candidate
    }
  }
}
