import {
  enabledGateways,
  enabledSearchProviders,
  providerMeta,
} from '#shared/utils/provider-meta'

export const AUTH_NEXT_QUERY_KEY = 'next'

export const KEYS_PAGE_TAB_IDS = ['providers', 'search', 'gateways'] as const

const KEYS_PAGE_PATHNAME = '/profile/keys'
const NEW_CHAT_PATHNAME = '/chats/new'
const URL_PARSE_BASE = 'http://localhost'
const NEXT_MAX_LENGTH = 200
const LAST_CONTROL_CODE_POINT = 0x1f
const DELETE_CODE_POINT = 0x7f
const BACKSLASH = '\\'

function firstValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0

    if (
      codePoint <= LAST_CONTROL_CODE_POINT
      || codePoint === DELETE_CODE_POINT
      || character === BACKSLASH
    ) {
      return true
    }
  }

  return false
}

function isKnownKeyTargetId(providerId: string): boolean {
  if (!Object.hasOwn(providerMeta, providerId)) {
    return false
  }

  const kind = providerMeta[providerId]?.kind

  if (kind === 'provider') {
    return true
  }

  if (kind === 'gateway') {
    return (enabledGateways as string[]).includes(providerId)
  }

  return kind === 'search' && enabledSearchProviders.includes(providerId)
}

function sanitizeKeysPageQuery(
  searchParams: URLSearchParams,
): URLSearchParams {
  const sanitized = new URLSearchParams()
  const provider = searchParams.get('provider')
  const tab = searchParams.get('tab')

  if (provider && isKnownKeyTargetId(provider)) {
    sanitized.set('provider', provider)
  }

  if (tab && (KEYS_PAGE_TAB_IDS as readonly string[]).includes(tab)) {
    sanitized.set('tab', tab)
  }

  return sanitized
}

/**
 * Open-redirect guard for the post-auth `next` parameter. Accepts only
 * same-origin relative paths whose pathname is allowlisted and rebuilds the
 * query from validated keys, so nothing attacker-controlled survives.
 */
export function resolveSafeNextPath(value: unknown): string | null {
  const candidate = firstValue(value)

  if (typeof candidate !== 'string' || !candidate) {
    return null
  }

  if (candidate.length > NEXT_MAX_LENGTH) {
    return null
  }

  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return null
  }

  if (hasUnsafeCharacters(candidate)) {
    return null
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(candidate, URL_PARSE_BASE)
  } catch {
    return null
  }

  if (parsedUrl.origin !== URL_PARSE_BASE) {
    return null
  }

  if (parsedUrl.pathname === NEW_CHAT_PATHNAME) {
    return NEW_CHAT_PATHNAME
  }

  if (parsedUrl.pathname !== KEYS_PAGE_PATHNAME) {
    return null
  }

  const query = sanitizeKeysPageQuery(parsedUrl.searchParams).toString()

  return query ? `${KEYS_PAGE_PATHNAME}?${query}` : KEYS_PAGE_PATHNAME
}

export function appendNextToPath(
  path: string,
  next: string | null | undefined,
): string {
  if (!next) {
    return path
  }

  const parsedUrl = new URL(path, URL_PARSE_BASE)

  parsedUrl.searchParams.set(AUTH_NEXT_QUERY_KEY, next)

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
}
