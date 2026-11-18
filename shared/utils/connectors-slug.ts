import {
  CONNECTOR_SLUG_MAX_LENGTH,
  CONNECTOR_SLUG_PATTERN,
} from '#shared/utils/connectors-policy'

const FALLBACK_SLUG = 'connector'
const COUNTRY_CODE_LENGTH = 2
const SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set([
  'co',
  'com',
  'org',
  'net',
  'gov',
  'edu',
  'ac',
  'or',
  'ne',
  'go',
])
const GENERIC_LABELS: ReadonlySet<string> = new Set([
  'mcp',
  'api',
  'www',
  'app',
  'server',
  'remote',
  'gateway',
])

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
 * Base slug for a connector host: the label closest to the public suffix
 * that is not a generic service label (`mcp.exa.ai` gives `exa`,
 * `mcp.example.co.uk` gives `example`). A host made only of generic labels
 * keeps its own last label.
 */
export function deriveConnectorSlugBase(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean)
  const suffixLength = labels.length >= 3
    && SECOND_LEVEL_LABELS.has(labels.at(-2)!)
    && labels.at(-1)!.length === COUNTRY_CODE_LENGTH
    ? 2
    : 1
  const nameLabels = labels.length > suffixLength
    ? labels.slice(0, labels.length - suffixLength)
    : labels
  const specific = nameLabels.filter(label => !GENERIC_LABELS.has(label))
  const label = specific.at(-1) ?? nameLabels.at(-1) ?? ''
  const slug = truncateSlug(
    sanitizeSlug(label),
    CONNECTOR_SLUG_MAX_LENGTH,
  )

  return slug || FALLBACK_SLUG
}

/**
 * Base slug for a title a person or a catalog chose, or null when the title
 * is empty after cleaning or looks like a host name, so the caller falls
 * through to the next source.
 */
export function deriveConnectorSlugBaseFromTitle(
  title: string | null | undefined,
): string | null {
  const trimmed = (title ?? '').trim()

  if (!trimmed || (trimmed.includes('.') && !/\s/.test(trimmed))) {
    return null
  }

  const slug = truncateSlug(
    sanitizeSlug(trimmed),
    CONNECTOR_SLUG_MAX_LENGTH,
  )

  return slug || null
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
