export const UTM_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
] as const

export type UtmQueryKey = typeof UTM_QUERY_KEYS[number]

export interface UtmParams {
  source?: string
  medium?: string
  campaign?: string
  content?: string
}

type UtmField = keyof UtmParams

const UTM_FIELD_BY_QUERY_KEY: Record<UtmQueryKey, UtmField> = {
  utm_source: 'source',
  utm_medium: 'medium',
  utm_campaign: 'campaign',
  utm_content: 'content',
}

const UTM_VALUE_PATTERN = /^[a-z0-9._-]+$/
const UTM_VALUE_MAX_LENGTH = 64
const URL_PARSE_BASE = 'http://localhost'
const NESTED_CALLBACK_QUERY_KEY = 'callbackURL'

function firstValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export function sanitizeUtmValue(value: unknown): string | undefined {
  const candidate = firstValue(value)

  if (typeof candidate !== 'string') {
    return undefined
  }

  const normalized = candidate.trim().toLowerCase()

  if (!normalized || normalized.length > UTM_VALUE_MAX_LENGTH) {
    return undefined
  }

  if (!UTM_VALUE_PATTERN.test(normalized)) {
    return undefined
  }

  return normalized
}

function readQueryValue(
  source: URLSearchParams | Record<string, unknown>,
  key: UtmQueryKey,
): unknown {
  if (source instanceof URLSearchParams) {
    return source.get(key)
  }

  return source[key]
}

export function sanitizeUtmParams(
  source: URLSearchParams | Record<string, unknown> | null | undefined,
): UtmParams {
  const utm: UtmParams = {}

  if (!source || typeof source !== 'object') {
    return utm
  }

  for (const key of UTM_QUERY_KEYS) {
    const value = sanitizeUtmValue(readQueryValue(source, key))

    if (value) {
      utm[UTM_FIELD_BY_QUERY_KEY[key]] = value
    }
  }

  return utm
}

export function hasUtmParams(utm: UtmParams | null | undefined): boolean {
  if (!utm) {
    return false
  }

  return UTM_QUERY_KEYS.some((key) => {
    return !!utm[UTM_FIELD_BY_QUERY_KEY[key]]
  })
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, URL_PARSE_BASE)
  } catch {
    return null
  }
}

export function extractUtmFromUrl(url: string | null | undefined): UtmParams {
  if (typeof url !== 'string' || !url) {
    return {}
  }

  const parsedUrl = parseUrl(url)

  if (!parsedUrl) {
    return {}
  }

  const utm = sanitizeUtmParams(parsedUrl.searchParams)

  if (hasUtmParams(utm)) {
    return utm
  }

  const nestedCallbackUrl = parsedUrl.searchParams.get(
    NESTED_CALLBACK_QUERY_KEY,
  )

  if (!nestedCallbackUrl) {
    return utm
  }

  const parsedNestedUrl = parseUrl(nestedCallbackUrl)

  if (!parsedNestedUrl) {
    return utm
  }

  return sanitizeUtmParams(parsedNestedUrl.searchParams)
}

export function appendUtmToPath(
  path: string,
  utm: UtmParams | null | undefined,
): string {
  if (!hasUtmParams(utm)) {
    return path
  }

  const parsedUrl = parseUrl(path)

  if (!parsedUrl) {
    return path
  }

  for (const key of UTM_QUERY_KEYS) {
    const value = sanitizeUtmValue(utm?.[UTM_FIELD_BY_QUERY_KEY[key]])

    if (value) {
      parsedUrl.searchParams.set(key, value)
    }
  }

  if (parsedUrl.origin !== URL_PARSE_BASE) {
    return parsedUrl.href
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
}
