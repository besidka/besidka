import { createError } from 'evlog'
import { and, eq, isNull } from 'drizzle-orm'
import { GOOGLE_SERVICES } from '#shared/utils/google-tool-catalog'
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

type DbClient = ReturnType<typeof useDb>

export interface BesidkaChatSettings {
  enabled: boolean
  alwaysAllowTools: Record<string, string>
  googleServicesOff: GoogleService[]
}

type BesidkaChatRowValues = Pick<
  BesidkaChatSettings,
  'enabled' | 'alwaysAllowTools'
>

export const DEFAULT_BESIDKA_CHAT_SETTINGS: BesidkaChatSettings = {
  enabled: true,
  alwaysAllowTools: {},
  googleServicesOff: [],
}

/**
 * The Google services switched off in a chat, from the stored text of
 * `besidka_chat_settings.google_services_off`. A missing value or an empty
 * list means every service is on. A list keeps the service ids it knows and
 * ignores any other string, so an id retired later cannot break a chat.
 * Anything else, text that is not JSON, JSON that is not a list of strings,
 * reads as every service off: off is the restrictive direction, so a
 * corrupt value never offers a tool the user may have switched off.
 */
export function parseGoogleServicesOff(
  stored: string | null | undefined,
): GoogleService[] {
  if (stored === null || stored === undefined) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(stored)
  } catch {
    return [...GOOGLE_SERVICES]
  }

  if (
    !Array.isArray(parsed)
    || parsed.some(entry => typeof entry !== 'string')
  ) {
    return [...GOOGLE_SERVICES]
  }

  return GOOGLE_SERVICES.filter(service => parsed.includes(service))
}

export function serializeGoogleServicesOff(
  services: readonly GoogleService[],
): string | null {
  const known = GOOGLE_SERVICES.filter(service => services.includes(service))

  return known.length ? JSON.stringify(known) : null
}

function isGrantMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(hash => typeof hash === 'string')
}

/**
 * The Besidka row of a chat: whether the model gets Besidka tools in it and
 * the "Allow in this chat" grants (exposed tool name to registry hash). A
 * chat without a row has Besidka on and no grants, so the tools are there
 * from the first message once the user opted in.
 */
export async function readBesidkaChatSettings(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<BesidkaChatSettings> {
  const [row] = await db.select({
    enabled: schema.besidkaChatSettings.enabled,
    alwaysAllowTools: schema.besidkaChatSettings.alwaysAllowTools,
    googleServicesOff: schema.besidkaChatSettings.googleServicesOff,
  })
    .from(schema.besidkaChatSettings)
    .where(and(
      eq(schema.besidkaChatSettings.userId, userId),
      eq(schema.besidkaChatSettings.chatPublicId, chatPublicId),
    ))
    .limit(1)

  if (!row) {
    return {
      ...DEFAULT_BESIDKA_CHAT_SETTINGS,
      alwaysAllowTools: {},
      googleServicesOff: [],
    }
  }

  return {
    enabled: row.enabled,
    alwaysAllowTools: isGrantMap(row.alwaysAllowTools)
      ? { ...row.alwaysAllowTools }
      : {},
    googleServicesOff: parseGoogleServicesOff(row.googleServicesOff),
  }
}

async function upsertBesidkaChatSettings(
  db: DbClient,
  input: { userId: number, chatPublicId: string } & BesidkaChatRowValues,
): Promise<void> {
  await db.insert(schema.besidkaChatSettings)
    .values({
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      enabled: input.enabled,
      alwaysAllowTools: input.alwaysAllowTools,
    })
    .onConflictDoUpdate({
      target: [
        schema.besidkaChatSettings.userId,
        schema.besidkaChatSettings.chatPublicId,
      ],
      set: {
        enabled: input.enabled,
        alwaysAllowTools: input.alwaysAllowTools,
        updatedAt: new Date(),
      },
    })
}

/**
 * Switches Besidka tools on or off for one chat and keeps the chat's
 * grants as they are.
 */
export async function setBesidkaChatEnabled(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  enabled: boolean,
): Promise<BesidkaChatSettings> {
  const current = await readBesidkaChatSettings(db, userId, chatPublicId)
  const next = { ...current, enabled }

  await upsertBesidkaChatSettings(db, { userId, chatPublicId, ...next })

  return next
}

/**
 * Stores an "Allow in this chat" grant for one Besidka tool, bound to the
 * registry hash it was given for, so a changed tool asks again.
 */
export async function addBesidkaChatGrant(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  grant: { toolName: string, definitionHash: string },
): Promise<void> {
  const current = await readBesidkaChatSettings(db, userId, chatPublicId)

  await upsertBesidkaChatSettings(db, {
    userId,
    chatPublicId,
    enabled: current.enabled,
    alwaysAllowTools: {
      ...current.alwaysAllowTools,
      [grant.toolName]: grant.definitionHash,
    },
  })
}

/**
 * Stores the Google services switched off in one chat. Only this column and
 * `updated_at` are written on an existing row, so Besidka's switch and the
 * chat's grants stay as they are; a row created here starts with Besidka on
 * and no grants. An empty list is stored as null, which means every service
 * is on, so the default needs no stored value.
 */
export async function setGoogleServicesOff(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  services: readonly GoogleService[],
): Promise<GoogleService[]> {
  const stored = serializeGoogleServicesOff(services)

  await db.insert(schema.besidkaChatSettings)
    .values({
      userId,
      chatPublicId,
      enabled: DEFAULT_BESIDKA_CHAT_SETTINGS.enabled,
      alwaysAllowTools: {},
      googleServicesOff: stored,
    })
    .onConflictDoUpdate({
      target: [
        schema.besidkaChatSettings.userId,
        schema.besidkaChatSettings.chatPublicId,
      ],
      set: {
        googleServicesOff: stored,
        updatedAt: new Date(),
      },
    })

  return parseGoogleServicesOff(stored)
}

function sameServices(
  first: readonly GoogleService[],
  second: readonly GoogleService[],
): boolean {
  return first.length === second.length
    && first.every(service => second.includes(service))
}

/**
 * The services a send runs with when its body carries the choice made before
 * the chat had a slug (`googleServicesOff` of the first send): the request
 * is stored when it differs from the stored value, and wins for this send
 * even if the write fails (the failure is logged and the next send reads
 * the stored value). Without a request nothing is read or written.
 */
export async function applyRequestedGoogleServicesOff(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  requested: readonly GoogleService[] | undefined,
  logger: { set: (data: Record<string, unknown>) => void },
): Promise<GoogleService[] | undefined> {
  if (requested === undefined) {
    return undefined
  }

  const requestedKnown = GOOGLE_SERVICES.filter((service) => {
    return requested.includes(service)
  })

  try {
    const stored = await readBesidkaChatSettings(db, userId, chatPublicId)

    if (!sameServices(stored.googleServicesOff, requestedKnown)) {
      await setGoogleServicesOff(db, userId, chatPublicId, requestedKnown)
    }
  } catch (exception) {
    logger.set({
      attributes: {
        googleTools: {
          servicesOffPersist: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return requestedKnown
}

const GOOGLE_SERVICE_WRITE_ATTEMPTS = 3

async function readStoredGoogleServicesOff(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<{ exists: boolean, stored: string | null }> {
  const [row] = await db.select({
    stored: schema.besidkaChatSettings.googleServicesOff,
  })
    .from(schema.besidkaChatSettings)
    .where(and(
      eq(schema.besidkaChatSettings.userId, userId),
      eq(schema.besidkaChatSettings.chatPublicId, chatPublicId),
    ))
    .limit(1)

  return { exists: !!row, stored: row?.stored ?? null }
}

/**
 * Switches one Google service on or off for one chat and keeps the other
 * services as they were. The list is read and written back as a whole, so
 * the write is a compare-and-swap: it only lands while the stored text is
 * still the text that was read (a missing row is inserted, and an insert
 * that loses to a concurrent insert counts as a lost swap). A lost swap
 * re-reads and tries again, up to three times, so two tabs changing
 * different services at once both stick; after that it answers 409 and the
 * caller reverts.
 */
export async function setGoogleServiceEnabled(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  service: GoogleService,
  enabled: boolean,
): Promise<GoogleService[]> {
  for (let attempt = 0; attempt < GOOGLE_SERVICE_WRITE_ATTEMPTS; attempt += 1) {
    const { exists, stored } = await readStoredGoogleServicesOff(
      db,
      userId,
      chatPublicId,
    )
    const off = new Set(parseGoogleServicesOff(stored))

    if (enabled) {
      off.delete(service)
    } else {
      off.add(service)
    }

    const next = serializeGoogleServicesOff([...off])

    const written = exists
      ? await db.update(schema.besidkaChatSettings)
        .set({ googleServicesOff: next, updatedAt: new Date() })
        .where(and(
          eq(schema.besidkaChatSettings.userId, userId),
          eq(schema.besidkaChatSettings.chatPublicId, chatPublicId),
          stored === null
            ? isNull(schema.besidkaChatSettings.googleServicesOff)
            : eq(schema.besidkaChatSettings.googleServicesOff, stored),
        ))
        .returning({ id: schema.besidkaChatSettings.id })
      : await db.insert(schema.besidkaChatSettings)
        .values({
          userId,
          chatPublicId,
          enabled: DEFAULT_BESIDKA_CHAT_SETTINGS.enabled,
          alwaysAllowTools: {},
          googleServicesOff: next,
        })
        .onConflictDoNothing()
        .returning({ id: schema.besidkaChatSettings.id })

    if (written.length) {
      return parseGoogleServicesOff(next)
    }
  }

  throw createError({
    message: 'Could not save the Google switch',
    status: 409,
    why: 'Another change to this chat\'s Google switches kept landing first',
    fix: 'Try again',
  })
}
