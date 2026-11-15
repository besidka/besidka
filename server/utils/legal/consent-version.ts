import type { KVNamespace } from '@cloudflare/workers-types'
import { desc } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

type ConsentVersionDatabase = Pick<DbClient, 'select'>

type ConsentVersionKV = Pick<KVNamespace, 'get' | 'put' | 'delete'>

/**
 * The consent version every user had accepted when owner approval of
 * consent versions was introduced (BES-396): `CURRENT_CONSENT_VERSION` was
 * set to this value in #531 and never changed, so no stored consent can
 * carry anything else. It is the approved version while no approval row
 * exists, and the fallback when neither KV nor D1 can be read. Never change
 * it: approve a newer version in the admin area instead.
 */
export const BASELINE_APPROVED_CONSENT_VERSION = '2026-11-a'

export const APPROVED_CONSENT_VERSION_CACHE_KEY
  = 'legal:consent-version:approved'

export const APPROVED_CONSENT_VERSION_CACHE_TTL_SECONDS = 3600

export const APPROVED_CONSENT_VERSION_MEMO_TTL_MS = 60_000

const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-[a-z]{1,8}$/

interface ApprovedConsentVersionMemo {
  version: string
  loadedAt: number
}

let approvedVersionMemo: ApprovedConsentVersionMemo | null = null

export function isConsentVersion(value: unknown): value is string {
  return typeof value === 'string' && CONSENT_VERSION_PATTERN.test(value)
}

/**
 * Orders `YYYY-MM-<letters>` versions: by month, then by suffix length,
 * then alphabetically, so `2026-11-z` sorts before `2026-11-aa`.
 */
export function compareConsentVersions(first: string, second: string): number {
  const [firstYear = '', firstMonth = '', firstSuffix = ''] = first.split('-')
  const [secondYear = '', secondMonth = '', secondSuffix = '']
    = second.split('-')
  const firstPeriod = `${firstYear}-${firstMonth}`
  const secondPeriod = `${secondYear}-${secondMonth}`

  if (firstPeriod !== secondPeriod) {
    return firstPeriod < secondPeriod ? -1 : 1
  }

  if (firstSuffix.length !== secondSuffix.length) {
    return firstSuffix.length < secondSuffix.length ? -1 : 1
  }

  if (firstSuffix === secondSuffix) {
    return 0
  }

  return firstSuffix < secondSuffix ? -1 : 1
}

export function resolveEffectiveConsentVersion(
  codeVersion: string,
  approvedVersion: string | null | undefined,
): string {
  const approved = isConsentVersion(approvedVersion)
    ? approvedVersion
    : BASELINE_APPROVED_CONSENT_VERSION

  return compareConsentVersions(codeVersion, approved) <= 0
    ? codeVersion
    : approved
}

export function getCachedApprovedConsentVersion(): string {
  return approvedVersionMemo?.version ?? BASELINE_APPROVED_CONSENT_VERSION
}

export function rememberApprovedConsentVersion(
  version: string,
  now: number = Date.now(),
): void {
  if (!isConsentVersion(version)) {
    return
  }

  approvedVersionMemo = { version, loadedAt: now }
}

export function resetApprovedConsentVersionMemo(): void {
  approvedVersionMemo = null
}

export async function readApprovedConsentVersionFromDb(
  db: ConsentVersionDatabase,
): Promise<string | null> {
  const [row] = await db
    .select({ version: schema.legalConsentVersionApprovals.version })
    .from(schema.legalConsentVersionApprovals)
    .orderBy(desc(schema.legalConsentVersionApprovals.id))
    .limit(1)

  return isConsentVersion(row?.version) ? row.version : null
}

function resolveKV(kv: ConsentVersionKV | undefined): ConsentVersionKV | null {
  if (kv) {
    return kv
  }

  try {
    return useKV()
  } catch {
    return null
  }
}

async function readCachedVersion(
  kv: ConsentVersionKV | null,
): Promise<string | null> {
  if (!kv) {
    return null
  }

  try {
    const cached = await kv.get(APPROVED_CONSENT_VERSION_CACHE_KEY)

    return isConsentVersion(cached) ? cached : null
  } catch {
    return null
  }
}

export async function cacheApprovedConsentVersion(
  version: string,
  kv?: ConsentVersionKV,
): Promise<void> {
  const store = resolveKV(kv)

  if (!store) {
    return
  }

  try {
    await store.put(APPROVED_CONSENT_VERSION_CACHE_KEY, version, {
      expirationTtl: APPROVED_CONSENT_VERSION_CACHE_TTL_SECONDS,
    })
  } catch {
    return
  }
}

/**
 * Refreshes the approved consent version for this isolate at most once a
 * minute: KV first, then D1 (which then refills KV). A failed read keeps the
 * last known value, or the baseline in a fresh isolate, so a storage outage
 * can never make a code bump take effect. Every path that compares consent
 * versions reaches this through `readLegalConsent` or a sweep entry point.
 */
export async function loadApprovedConsentVersion(input: {
  db?: ConsentVersionDatabase
  kv?: ConsentVersionKV
  now?: number
} = {}): Promise<string> {
  const now = input.now ?? Date.now()

  if (
    approvedVersionMemo
    && now - approvedVersionMemo.loadedAt < APPROVED_CONSENT_VERSION_MEMO_TTL_MS
  ) {
    return approvedVersionMemo.version
  }

  const kv = resolveKV(input.kv)
  const cached = await readCachedVersion(kv)

  if (cached) {
    rememberApprovedConsentVersion(cached, now)

    return cached
  }

  try {
    const stored = await readApprovedConsentVersionFromDb(input.db ?? useDb())
    const version = stored ?? BASELINE_APPROVED_CONSENT_VERSION

    rememberApprovedConsentVersion(version, now)

    if (kv) {
      await cacheApprovedConsentVersion(version, kv)
    }

    return version
  } catch {
    return getCachedApprovedConsentVersion()
  }
}
