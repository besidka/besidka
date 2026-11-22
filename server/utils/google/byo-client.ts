import { and, eq } from 'drizzle-orm'
import {
  GOOGLE_BYO_KEY_PROVIDER,
  googleClientIdHint,
  isGoogleOAuthClientId,
  isGoogleOAuthClientSecret,
} from '#shared/utils/google-byo'
import type { GoogleByoClientSummary } from '#shared/utils/google-byo'
import * as schema from '~~/server/db/schema'

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

function parseStoredClient(plain: string): GoogleByoClientCredentials | null {
  let value: unknown

  try {
    value = JSON.parse(plain)
  } catch {
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
): Promise<GoogleByoClientCredentials | null> {
  const [row] = await db
    .select({ apiKey: schema.keys.apiKey })
    .from(schema.keys)
    .where(isOwnKeyRow(userId))
    .limit(1)

  if (!row) {
    return null
  }

  try {
    return parseStoredClient(await useDecryptText(row.apiKey))
  } catch {
    return null
  }
}

/**
 * What the API Keys page may know about the stored client: that one is
 * saved, and the last four characters of its client id. Never the secret.
 */
export async function readGoogleByoClientSummary(
  db: DbClient,
  userId: number,
): Promise<GoogleByoClientSummary | null> {
  const client = await readGoogleByoClient(db, userId)

  if (!client) {
    return null
  }

  return { clientIdHint: googleClientIdHint(client.clientId) }
}

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
 * Creates or replaces the stored client as one encrypted JSON value.
 */
export async function saveGoogleByoClient(
  db: DbClient,
  userId: number,
  credentials: GoogleByoClientCredentials,
): Promise<{ created: boolean }> {
  const apiKey = await useEncryptText(JSON.stringify({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  }))
  const updated = await db
    .update(schema.keys)
    .set({ apiKey, updatedAt: new Date() })
    .where(isOwnKeyRow(userId))
    .returning({ id: schema.keys.id })

  if (updated.length > 0) {
    return { created: false }
  }

  await db.insert(schema.keys).values({
    userId,
    provider: GOOGLE_BYO_KEY_PROVIDER,
    apiKey,
  })

  return { created: true }
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
