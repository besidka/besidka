import type { CookieCategoryDeclaration } from '~~/modules/cookie-consent/src/runtime/types/module'

export type ConsentDecision = 'all' | 'partial' | 'none'

export interface ParsedConsentCookie {
  v: number
  granted: string[]
  id?: string
  date?: string
}

/**
 * Derive a decision bucket over the non-required (optional) categories.
 *
 * - 'all'     — every optional category is granted, or there are none
 * - 'none'    — no optional category is granted
 * - 'partial' — some optional categories are granted, some are not
 */
export function deriveConsentDecision(
  grantedIds: string[],
  categories: CookieCategoryDeclaration[],
): ConsentDecision {
  const optional = categories.filter(category => !category.required)

  if (optional.length === 0) {
    return 'all'
  }

  const grantedOptional = optional.filter((category) => {
    return grantedIds.includes(category.id)
  })

  if (grantedOptional.length === 0) {
    return 'none'
  }

  if (grantedOptional.length === optional.length) {
    return 'all'
  }

  return 'partial'
}

/**
 * Safely parse the raw consent cookie JSON value.
 * Returns null when absent, unparseable, or structurally invalid.
 */
export function parseConsentCookieValue(
  raw: string | null | undefined,
): ParsedConsentCookie | null {
  if (!raw) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    !parsed
    || typeof parsed !== 'object'
    || typeof (parsed as Record<string, unknown>).v !== 'number'
    || !Array.isArray((parsed as Record<string, unknown>).granted)
  ) {
    return null
  }

  const record = parsed as Record<string, unknown>

  return {
    v: record.v as number,
    granted: record.granted as string[],
    id: typeof record.id === 'string' ? record.id : undefined,
    date: typeof record.date === 'string' ? record.date : undefined,
  }
}

/**
 * Mirrors the revision and category rules of the module's server-side
 * `getCookieConsent()` for code that only has the raw cookie value, such as
 * Better Auth hooks that receive no H3 event.
 */
export function isConsentCategoryGranted(
  raw: string | null | undefined,
  categoryId: string,
  revision: number,
): boolean {
  const parsed = parseConsentCookieValue(raw)

  if (!parsed || parsed.v !== revision) {
    return false
  }

  return parsed.granted.includes(categoryId)
}
