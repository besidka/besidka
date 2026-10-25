import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AboutMeNotMigratedReason } from '#shared/types/memory.d'
import {
  MEMORY_LIMITS,
  MEMORY_SETTING_DEFAULTS,
} from '#shared/utils/memory-policy'
import { buildAboutMeDescription } from '#shared/utils/memory-about-me'
import { memoryByteLength } from '#shared/utils/memory-schemas'
import * as schema from '~~/server/db/schema'
import { createMemoryEntry } from '~~/server/utils/memory/entries'
import type { MemoryWriteLogger } from '~~/server/utils/memory/entries'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'

type DbClient = ReturnType<typeof useDb>

export type AboutMeMigrationOutcome
  = | { status: 'migrated' }
    | { status: 'skipped', reason: 'empty' | AboutMeNotMigratedReason }

export interface AboutMeMigrationSettings {
  aboutMe: string | null
  memoryEnabled: boolean | null
}

interface ExistingProfileEntry {
  title: string
  body: string
}

export interface AboutMeMigrationInput {
  db: DbClient
  userId: number
  logger: MemoryWriteLogger
  settings?: AboutMeMigrationSettings | null
  recordCompliance?: boolean
}

const ABOUT_ME_ENTRY_TITLE = 'About me'
const COMPLIANCE_ORIGIN = 'about-me-migration'
const COMPLIANCE_REFUSAL_STATUS = 422
const CONFLICT_STATUS = 409

function skipped(
  reason: 'empty' | AboutMeNotMigratedReason,
): AboutMeMigrationOutcome {
  return { status: 'skipped', reason }
}

async function findAccountProfileEntry(
  db: DbClient,
  userId: number,
): Promise<ExistingProfileEntry | null> {
  const [existing] = await db
    .select({
      title: schema.memoryEntries.title,
      body: schema.memoryEntries.body,
    })
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      eq(schema.memoryEntries.category, 'profile'),
      isNull(schema.memoryEntries.projectId),
    ))
    .limit(1)

  return existing ?? null
}

async function isAccountMemoryFull(
  db: DbClient,
  userId: number,
): Promise<boolean> {
  const [counted] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      isNull(schema.memoryEntries.projectId),
    ))

  return Number(counted?.total ?? 0) >= MEMORY_LIMITS.maxAccountEntries
}

async function clearAboutMe(db: DbClient, userId: number): Promise<void> {
  await db
    .update(schema.userSettings)
    .set({ aboutMe: null })
    .where(eq(schema.userSettings.userId, userId))
}

/**
 * An existing profile entry is never overwritten. The one exception is an
 * entry that already holds exactly this text under the migration title: the
 * insert of an earlier or concurrent run landed and only the clear is
 * missing, so the clear is completed and the run counts as migrated.
 */
async function resolveExistingProfile(
  db: DbClient,
  userId: number,
  aboutMe: string,
  existing: ExistingProfileEntry,
): Promise<AboutMeMigrationOutcome> {
  if (existing.title === ABOUT_ME_ENTRY_TITLE && existing.body === aboutMe) {
    await clearAboutMe(db, userId)

    return { status: 'migrated' }
  }

  return skipped('profile-exists')
}

async function resolveCreateFailure(
  db: DbClient,
  userId: number,
  aboutMe: string,
  exception: unknown,
): Promise<AboutMeMigrationOutcome> {
  const { status } = memoryExtractionErrorSummary(exception)

  if (status === COMPLIANCE_REFUSAL_STATUS) {
    return skipped('rejected')
  }

  if (status === CONFLICT_STATUS) {
    const existing = await findAccountProfileEntry(db, userId)

    if (existing) {
      return await resolveExistingProfile(db, userId, aboutMe, existing)
    }

    if (await isAccountMemoryFull(db, userId)) {
      return skipped('entries-full')
    }
  }

  throw exception
}

async function readMigrationSettings(
  db: DbClient,
  userId: number,
): Promise<AboutMeMigrationSettings | null> {
  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: { aboutMe: true, memoryEnabled: true },
  })

  return settings ?? null
}

async function runMigration(
  input: AboutMeMigrationInput,
): Promise<AboutMeMigrationOutcome> {
  const { db, userId, logger, recordCompliance = true } = input
  const settings = input.settings === undefined
    ? await readMigrationSettings(db, userId)
    : input.settings
  const aboutMe = settings?.aboutMe?.trim() ?? ''

  if (aboutMe === '') {
    return skipped('empty')
  }

  const isMemoryEnabled = settings?.memoryEnabled
    ?? MEMORY_SETTING_DEFAULTS.memoryEnabled

  if (!isMemoryEnabled) {
    return skipped('memory-off')
  }

  if (memoryByteLength(aboutMe) > MEMORY_LIMITS.maxAlwaysInjectedBodyBytes) {
    return skipped('too-long')
  }

  const existing = await findAccountProfileEntry(db, userId)

  if (existing) {
    return await resolveExistingProfile(db, userId, aboutMe, existing)
  }

  try {
    await createMemoryEntry(
      { db, userId, logger: recordCompliance ? logger : undefined },
      {
        input: {
          category: 'profile',
          title: ABOUT_ME_ENTRY_TITLE,
          description: buildAboutMeDescription(aboutMe),
          body: aboutMe,
        },
        origin: 'user',
        complianceOrigin: COMPLIANCE_ORIGIN,
      },
    )
  } catch (exception) {
    return await resolveCreateFailure(db, userId, aboutMe, exception)
  }

  await clearAboutMe(db, userId)

  return { status: 'migrated' }
}

/**
 * Moves the legacy free-text "About me" into the account `profile` memory
 * entry, once. Every skip leaves `user_settings.about_me` untouched so the
 * text keeps being injected. `createMemoryEntry` cannot join a `db.batch`
 * (a guarded `insert ... select` followed by a read), so the insert comes
 * first and the column is cleared afterwards; a clear that never ran is
 * completed by the next call (see `resolveExistingProfile`). The cleared
 * column is the migration marker. Only the outcome label is logged, never
 * the text; the frequent `empty` outcome is not logged.
 *
 * `settings` is the caller's already-loaded `user_settings` row (`null` for
 * no row); it is read here only when omitted. `recordCompliance: false`
 * keeps the compliance gate from logging counts, for callers that retry the
 * same rejected text on every request.
 */
export async function migrateAboutMeToProfileEntry(
  input: AboutMeMigrationInput,
): Promise<AboutMeMigrationOutcome> {
  const outcome = await runMigration(input)

  if (outcome.status === 'migrated') {
    input.logger.set({
      attributes: { memoryMigration: { aboutMe: 'migrated' } },
    })
  } else if (outcome.reason !== 'empty') {
    input.logger.set({
      attributes: { memoryMigration: { aboutMe: outcome.reason } },
    })
  }

  return outcome
}
