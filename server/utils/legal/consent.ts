import type { SQL } from 'drizzle-orm'
import type { TransferConsentRoute } from '#shared/utils/legal-consent'
import type {
  LegalConsentState,
  LegalConsentStatus,
  ProviderTransferConsent,
  ProviderTransferConsents,
  TransferConsentProviderId,
} from '#shared/types/legal-consent.d'
import {
  LEGAL_CONSENT_ERROR_CODE,
  TRANSFER_CONSENT_ERROR_CODE,
  isTransferConsentProviderId,
  resolveTransferConsentProviderId,
  transferConsentProviderIds,
  transferConsentProviders,
} from '#shared/utils/legal-consent'
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  BASELINE_APPROVED_CONSENT_VERSION,
  compareConsentVersions,
  getCachedApprovedConsentVersion,
  isApprovedConsentVersionUnavailable,
  isConsentVersion,
  loadApprovedConsentVersion,
  resolveEffectiveConsentVersion,
} from '~~/server/utils/legal/consent-version'

export const CURRENT_CONSENT_VERSION = '2026-11-a'

/**
 * SHA-256 of the consent wording in the consent modal
 * (`app/components/Legal/ConsentModal.client.vue`, the `data-consent-text`
 * spans, tags stripped, whitespace collapsed). The spec
 * `tests/unit/server/utils/legal/consent-text-version.spec.ts` fails when the
 * wording changes, so a wording change cannot ship without a deliberate
 * decision on `CURRENT_CONSENT_VERSION`, whose bump asks every user again
 * once the owner approves it in the admin area.
 */
export const CURRENT_CONSENT_TEXT_SHA256
  = '5d5e5bb79d6ddeb80074fabebd6fb21c2046ed1ae8849e4f499337feefeb7ad5'

/**
 * The consent version users are asked for and recorded under:
 * `CURRENT_CONSENT_VERSION` capped at the last version the owner approved in
 * the admin area, so a bump in code re-prompts nobody until it is approved.
 */
export function getEffectiveConsentVersion(): string {
  return resolveEffectiveConsentVersion(
    CURRENT_CONSENT_VERSION,
    getCachedApprovedConsentVersion(),
  )
}

/**
 * Whether a stored consent version is the one users are asked for. While the
 * approved version cannot be read, any version from the baseline up to the
 * code version counts, so a storage outage never re-prompts anyone.
 */
export function isEffectiveConsentVersion(
  version: string | null | undefined,
): boolean {
  if (!isApprovedConsentVersionUnavailable()) {
    return version === getEffectiveConsentVersion()
  }

  if (!isConsentVersion(version)) {
    return false
  }

  const lowestPossible = resolveEffectiveConsentVersion(
    CURRENT_CONSENT_VERSION,
    BASELINE_APPROVED_CONSENT_VERSION,
  )

  return compareConsentVersions(version, lowestPossible) >= 0
    && compareConsentVersions(version, CURRENT_CONSENT_VERSION) <= 0
}

const PRIVACY_POLICY_CONSENT_LINK
  = '/privacy-policy#sensitive-information-in-your-chats'

type DbClient = ReturnType<typeof useDb>

export interface LegalConsentRecord {
  termsAcceptedAt: Date | null
  termsVersion: string | null
  ageConfirmedAt: Date | null
  sensitiveContentConsentAt: Date | null
  sensitiveContentConsentVersion: string | null
  sensitiveContentConsentWithdrawnAt: Date | null
  providerTransferConsents: ProviderTransferConsents | null
}

export const legalConsentColumns = {
  termsAcceptedAt: true,
  termsVersion: true,
  ageConfirmedAt: true,
  sensitiveContentConsentAt: true,
  sensitiveContentConsentVersion: true,
  sensitiveContentConsentWithdrawnAt: true,
  providerTransferConsents: true,
} as const

const emptyLegalConsentRecord: LegalConsentRecord = {
  termsAcceptedAt: null,
  termsVersion: null,
  ageConfirmedAt: null,
  sensitiveContentConsentAt: null,
  sensitiveContentConsentVersion: null,
  sensitiveContentConsentWithdrawnAt: null,
  providerTransferConsents: null,
}

function isWithdrawnAfterGrant(
  grantedAt: Date | number,
  withdrawnAt: Date | number | null | undefined,
): boolean {
  if (withdrawnAt === null || withdrawnAt === undefined) {
    return false
  }

  return new Date(withdrawnAt).getTime() >= new Date(grantedAt).getTime()
}

export function getLegalConsentStatus(
  record: Partial<LegalConsentRecord> | null | undefined,
): LegalConsentStatus {
  const consentedAt = record?.sensitiveContentConsentAt

  if (!consentedAt) {
    return 'missing'
  }

  if (
    isWithdrawnAfterGrant(
      consentedAt,
      record.sensitiveContentConsentWithdrawnAt,
    )
  ) {
    return 'withdrawn'
  }

  const isCurrentVersion
    = isEffectiveConsentVersion(record.sensitiveContentConsentVersion)
      && isEffectiveConsentVersion(record.termsVersion)
      && Boolean(record.termsAcceptedAt)
      && Boolean(record.ageConfirmedAt)

  return isCurrentVersion ? 'current' : 'outdated'
}

export function hasCurrentLegalConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
): boolean {
  return getLegalConsentStatus(record) === 'current'
}

export function isTransferConsentGranted(
  consent: ProviderTransferConsent | null | undefined,
): boolean {
  if (!consent?.consentedAt) {
    return false
  }

  return !isWithdrawnAfterGrant(consent.consentedAt, consent.withdrawnAt)
}

export function hasProviderTransferConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
  providerId: string | null | undefined,
): boolean {
  if (!isTransferConsentProviderId(providerId)) {
    return true
  }

  return isTransferConsentGranted(
    record?.providerTransferConsents?.[providerId],
  )
}

export function hasModelTransferConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
  route: TransferConsentRoute,
): boolean {
  return hasProviderTransferConsent(
    record,
    resolveTransferConsentProviderId(route),
  )
}

export function withoutUnconsentedTransferProviders(
  providerIds: Set<string>,
  record: Partial<LegalConsentRecord> | null | undefined,
): Set<string> {
  return new Set([...providerIds].filter((providerId) => {
    return hasProviderTransferConsent(record, providerId)
  }))
}

/**
 * The same rule as `getLegalConsentStatus() === 'current'`, as a SQL
 * condition over `user_settings`, for queries that pick background work.
 */
export function currentLegalConsentCondition(): SQL {
  const effectiveVersion = getEffectiveConsentVersion()

  return and(
    isNotNull(schema.userSettings.sensitiveContentConsentAt),
    eq(
      schema.userSettings.sensitiveContentConsentVersion,
      effectiveVersion,
    ),
    eq(schema.userSettings.termsVersion, effectiveVersion),
    isNotNull(schema.userSettings.termsAcceptedAt),
    isNotNull(schema.userSettings.ageConfirmedAt),
    or(
      isNull(schema.userSettings.sensitiveContentConsentWithdrawnAt),
      lt(
        schema.userSettings.sensitiveContentConsentWithdrawnAt,
        schema.userSettings.sensitiveContentConsentAt,
      ),
    ),
  ) as SQL
}

export async function readLegalConsent(
  userId: number,
  db: DbClient = useDb(),
): Promise<LegalConsentRecord> {
  await loadApprovedConsentVersion({ db })

  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: legalConsentColumns,
  })

  return settings ?? emptyLegalConsentRecord
}

export async function hasUserLegalConsent(
  userId: number,
  db: DbClient = useDb(),
): Promise<boolean> {
  return hasCurrentLegalConsent(await readLegalConsent(userId, db))
}

const refusalByStatus: Record<
  Exclude<LegalConsentStatus, 'current'>,
  { why: string, fix: string }
> = {
  missing: {
    why: 'You have not yet accepted the Terms of Use or given your consent to store sensitive information.',
    fix: 'Open any chat and confirm the two boxes in the consent dialog, or open Profile → Security → Privacy & consent.',
  },
  withdrawn: {
    why: 'You withdrew your consent to store sensitive information, so Besidka does not send new messages or store new content.',
    fix: 'Give your consent again in Profile → Security → Privacy & consent, or keep reading, exporting and deleting your data.',
  },
  outdated: {
    why: 'The Terms of Use and the consent text changed since you last agreed to them.',
    fix: 'Open any chat and confirm the updated consent dialog.',
  },
}

export function assertLegalConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
): void {
  const status = getLegalConsentStatus(record)

  if (status === 'current') {
    return
  }

  throw createError({
    code: LEGAL_CONSENT_ERROR_CODE,
    message: 'Consent is required before you send messages or add content',
    status: 403,
    why: refusalByStatus[status].why,
    fix: refusalByStatus[status].fix,
    link: PRIVACY_POLICY_CONSENT_LINK,
    data: { reason: 'legal-consent', consentStatus: status },
  })
}

export async function requireLegalConsent(
  userId: number,
  db: DbClient = useDb(),
): Promise<LegalConsentRecord> {
  const record = await readLegalConsent(userId, db)

  assertLegalConsent(record)

  return record
}

export function assertProviderTransferConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
  providerId: string | null | undefined,
): void {
  if (hasProviderTransferConsent(record, providerId)) {
    return
  }

  const provider = transferConsentProviders[
    providerId as TransferConsentProviderId
  ]

  if (provider.route === 'router') {
    throw createError({
      code: TRANSFER_CONSENT_ERROR_CODE,
      message: 'Consent is required before sending messages through a model router',
      status: 403,
      data: { reason: 'transfer-consent', provider: provider.id },
      why: 'A router or preset model can send your messages to providers in countries without an EU adequacy decision, such as China or Singapore, and you have not consented to that transfer.',
      fix: 'Confirm the transfer in the dialog shown before sending, or choose a specific model instead of a router.',
      link: '/privacy-policy#transfers-outside-the-eu',
    })
  }

  throw createError({
    code: TRANSFER_CONSENT_ERROR_CODE,
    message: `Consent is required before sending messages to ${provider.label}`,
    status: 403,
    data: { reason: 'transfer-consent', provider: provider.id },
    why: `${provider.label} processes data in ${provider.country}, which has no EU adequacy decision, and you have not consented to that transfer.`,
    fix: `Confirm the transfer to ${provider.country} in the dialog shown before sending, or choose a model from another provider.`,
    link: '/privacy-policy#transfers-outside-the-eu',
  })
}

function toIsoString(value: Date | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return new Date(value).toISOString()
}

export function toLegalConsentState(
  record: LegalConsentRecord,
): LegalConsentState {
  return {
    currentVersion: getEffectiveConsentVersion(),
    status: getLegalConsentStatus(record),
    termsAcceptedAt: toIsoString(record.termsAcceptedAt),
    termsVersion: record.termsVersion,
    ageConfirmedAt: toIsoString(record.ageConfirmedAt),
    sensitiveContentConsentAt: toIsoString(record.sensitiveContentConsentAt),
    sensitiveContentConsentVersion: record.sensitiveContentConsentVersion,
    sensitiveContentConsentWithdrawnAt: toIsoString(
      record.sensitiveContentConsentWithdrawnAt,
    ),
    transfers: transferConsentProviderIds.map((providerId) => {
      const provider = transferConsentProviders[providerId]
      const consent = record.providerTransferConsents?.[providerId]

      return {
        providerId,
        label: provider.label,
        country: provider.country,
        route: provider.route,
        consentedAt: toIsoString(consent?.consentedAt),
        withdrawnAt: toIsoString(consent?.withdrawnAt),
        isGranted: isTransferConsentGranted(consent),
      }
    }),
  }
}

export function assertModelTransferConsent(
  record: Partial<LegalConsentRecord> | null | undefined,
  route: TransferConsentRoute,
): void {
  assertProviderTransferConsent(
    record,
    resolveTransferConsentProviderId(route),
  )
}

function toWholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000)
}

async function upsertUserSettings(
  userId: number,
  values: Partial<typeof schema.userSettings.$inferInsert>,
  db: DbClient,
): Promise<void> {
  await db.insert(schema.userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: values,
    })
}

export function throwConsentVersionUnavailable(): never {
  throw createError({
    message: 'Consent cannot be recorded right now',
    status: 503,
    why: 'The approved consent version could not be read.',
    fix: 'Try again in a minute.',
  })
}

/**
 * Records the Terms, age and Art. 9 consent under `version`, the effective
 * version the caller showed and checked; without it, the effective version
 * read here. Refuses with 503 while the approved version cannot be read, so
 * a consent is never recorded under a guessed version.
 */
export async function recordLegalConsent(
  userId: number,
  db: DbClient = useDb(),
  now: Date = new Date(),
  version?: string,
): Promise<LegalConsentRecord> {
  const grantedAt = toWholeSecond(now)
  const existing = await readLegalConsent(userId, db)

  if (isApprovedConsentVersionUnavailable()) {
    throwConsentVersionUnavailable()
  }

  const effectiveVersion = version ?? getEffectiveConsentVersion()
  const hasSameSecondWithdrawal = isWithdrawnAfterGrant(
    grantedAt,
    existing.sensitiveContentConsentWithdrawnAt,
  )

  await upsertUserSettings(userId, {
    termsAcceptedAt: grantedAt,
    termsVersion: effectiveVersion,
    ageConfirmedAt: grantedAt,
    sensitiveContentConsentAt: grantedAt,
    sensitiveContentConsentVersion: effectiveVersion,
    ...(hasSameSecondWithdrawal
      ? { sensitiveContentConsentWithdrawnAt: null }
      : {}),
  }, db)

  return await readLegalConsent(userId, db)
}

export async function withdrawLegalConsent(
  userId: number,
  db: DbClient = useDb(),
  now: Date = new Date(),
): Promise<LegalConsentRecord> {
  await upsertUserSettings(userId, {
    sensitiveContentConsentWithdrawnAt: toWholeSecond(now),
  }, db)
  await db.update(schema.memoryBackfillJobs)
    .set({ status: 'cancelled', finishedAt: now })
    .where(and(
      eq(schema.memoryBackfillJobs.userId, userId),
      eq(schema.memoryBackfillJobs.status, 'running'),
    ))

  return await readLegalConsent(userId, db)
}

/**
 * One atomic UPDATE per change, so a grant and a withdrawal for different
 * providers racing each other can never drop one another: SQLite's
 * `json_set` rewrites only this provider's key inside the stored object. A
 * withdrawal touches only a provider that was granted before.
 */
async function writeProviderTransferConsent(
  userId: number,
  providerId: TransferConsentProviderId,
  isGranted: boolean,
  db: DbClient,
  now: Date,
): Promise<LegalConsentRecord> {
  const column = schema.userSettings.providerTransferConsents
  const stored = sql`coalesce(${column}, '{}')`
  const providerPath = `$.${providerId}`
  const timestamp = now.getTime()

  await db.insert(schema.userSettings)
    .values({ userId })
    .onConflictDoNothing({ target: schema.userSettings.userId })

  if (isGranted) {
    await db.update(schema.userSettings)
      .set({
        providerTransferConsents: sql`json_set(${stored}, ${providerPath}, json_object('consentedAt', ${timestamp}, 'withdrawnAt', json_extract(${stored}, ${`${providerPath}.withdrawnAt`})))`,
      })
      .where(eq(schema.userSettings.userId, userId))
  } else {
    await db.update(schema.userSettings)
      .set({
        providerTransferConsents: sql`json_set(${stored}, ${`${providerPath}.withdrawnAt`}, ${timestamp})`,
      })
      .where(and(
        eq(schema.userSettings.userId, userId),
        sql`json_extract(${stored}, ${providerPath}) is not null`,
      ))
  }

  return await readLegalConsent(userId, db)
}

export async function recordProviderTransferConsent(
  userId: number,
  providerId: TransferConsentProviderId,
  db: DbClient = useDb(),
  now: Date = new Date(),
): Promise<LegalConsentRecord> {
  return await writeProviderTransferConsent(userId, providerId, true, db, now)
}

export async function withdrawProviderTransferConsent(
  userId: number,
  providerId: TransferConsentProviderId,
  db: DbClient = useDb(),
  now: Date = new Date(),
): Promise<LegalConsentRecord> {
  return await writeProviderTransferConsent(userId, providerId, false, db, now)
}
