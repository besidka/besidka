import { and, eq } from 'drizzle-orm'
import {
  GOOGLE_BYO_KEY_PROVIDER,
  isGoogleOAuthClientId,
  isGoogleOAuthClientSecret,
} from '#shared/utils/google-byo'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export interface GoogleByoClientCredentials {
  clientId: string
  clientSecret: string
}

function isOwnKeyRow(userId: number) {
  return and(
    eq(schema.keys.userId, userId),
    eq(schema.keys.provider, GOOGLE_BYO_KEY_PROVIDER),
  )
}

function logUnreadable(logger: LoggerLike | undefined, exception: unknown) {
  logger?.set({
    attributes: {
      google: {
        byoClientUnreadable: exceptionMessage(exception).slice(0, 80),
      },
    },
  })
}

function parseStoredClient(
  plain: string,
  logger?: LoggerLike,
): GoogleByoClientCredentials | null {
  let value: unknown

  try {
    value = JSON.parse(plain)
  } catch (exception) {
    logUnreadable(logger, exception)

    return null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.clientId !== 'string'
    || typeof candidate.clientSecret !== 'string'
    || !isGoogleOAuthClientId(candidate.clientId)
    || !isGoogleOAuthClientSecret(candidate.clientSecret)
  ) {
    return null
  }

  return {
    clientId: candidate.clientId,
    clientSecret: candidate.clientSecret,
  }
}

/**
 * The owner's own OAuth client, decrypted. The only place that decrypts
 * the stored client: it lives in one `keys` row of the
 * `google-oauth-client` kind as one encrypted JSON value holding the
 * client id and secret. `null` when nothing is stored or the value cannot
 * be decrypted or read. The secret never leaves the server.
 */
export async function readGoogleByoClient(
  db: DbClient,
  userId: number,
  logger?: LoggerLike,
): Promise<GoogleByoClientCredentials | null> {
  const [row] = await db
    .select({ apiKey: schema.keys.apiKey })
    .from(schema.keys)
    .where(isOwnKeyRow(userId))
    .limit(1)

  if (!row) {
    return null
  }

  let plain: string

  try {
    plain = await useDecryptText(row.apiKey)
  } catch (exception) {
    logUnreadable(logger, exception)

    return null
  }

  return parseStoredClient(plain, logger)
}

/**
 * Whether a client is stored, without decrypting anything: the status
 * route answers only "saved" or "not saved", so a status read never
 * touches the secret.
 */
export async function hasStoredGoogleByoClient(
  db: DbClient,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.keys.id })
    .from(schema.keys)
    .where(isOwnKeyRow(userId))
    .limit(1)

  return !!row
}

/**
 * Whether saving `clientId` replaces a stored client with another one: a
 * different client id, or a stored value that can no longer be read. The
 * caller then ends the connection made with the old client before saving,
 * because its refresh token belongs to that client. A secret-only rotation
 * of the same client keeps the connection.
 */
export async function isGoogleByoClientReplacement(
  db: DbClient,
  userId: number,
  clientId: string,
): Promise<boolean> {
  if (!await hasStoredGoogleByoClient(db, userId)) {
    return false
  }

  const previous = await readGoogleByoClient(db, userId)

  return previous?.clientId !== clientId
}

/**
 * Creates or replaces the stored client as one encrypted JSON value, in a
 * single upsert on the unique `(user_id, provider)` index, so two saves at
 * the same moment cannot collide.
 */
export async function saveGoogleByoClient(
  db: DbClient,
  userId: number,
  credentials: GoogleByoClientCredentials,
): Promise<void> {
  const apiKey = await useEncryptText(JSON.stringify({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  }))
  const now = new Date()

  await db
    .insert(schema.keys)
    .values({
      userId,
      provider: GOOGLE_BYO_KEY_PROVIDER,
      apiKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.keys.userId, schema.keys.provider],
      set: { apiKey, updatedAt: now },
    })
}

export async function deleteGoogleByoClient(
  db: DbClient,
  userId: number,
): Promise<boolean> {
  const deleted = await db
    .delete(schema.keys)
    .where(isOwnKeyRow(userId))
    .returning({ id: schema.keys.id })

  return deleted.length > 0
}
