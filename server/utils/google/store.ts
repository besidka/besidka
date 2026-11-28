import { and, eq } from 'drizzle-orm'
import {
  getGrantedCapabilities,
  getPartialCalendarAccess,
  isWorkspaceAccountEmail,
} from '#shared/utils/google-connections'
import type {
  GoogleConnectionStatus,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

/**
 * A connection without its token columns. Everything outside
 * `server/utils/google/tokens.ts` reads connections through this shape.
 */
export interface GoogleConnectionRecord {
  id: string
  userId: number
  clientMode: GoogleClientMode
  googleSubject: string | null
  googleEmail: string | null
  grantedScopes: string[]
  status: GoogleConnectionStatus
  createdAt: Date
  updatedAt: Date
}

export const googleConnectionRecordColumns = {
  id: schema.googleConnections.id,
  userId: schema.googleConnections.userId,
  clientMode: schema.googleConnections.clientMode,
  googleSubject: schema.googleConnections.googleSubject,
  googleEmail: schema.googleConnections.googleEmail,
  grantedScopes: schema.googleConnections.grantedScopes,
  status: schema.googleConnections.status,
  createdAt: schema.googleConnections.createdAt,
  updatedAt: schema.googleConnections.updatedAt,
}

export async function readGoogleConnection(
  db: DbClient,
  userId: number,
  clientMode: GoogleClientMode,
): Promise<GoogleConnectionRecord | null> {
  const [row] = await db
    .select(googleConnectionRecordColumns)
    .from(schema.googleConnections)
    .where(and(
      eq(schema.googleConnections.userId, userId),
      eq(schema.googleConnections.clientMode, clientMode),
    ))
    .limit(1)

  return row ?? null
}

export function toGoogleConnectionSummary(
  record: GoogleConnectionRecord,
): GoogleConnectionSummary {
  const partialCalendar = record.status === 'active'
    ? getPartialCalendarAccess(record.grantedScopes)
    : null

  return {
    clientMode: record.clientMode,
    status: record.status,
    email: record.googleEmail,
    isWorkspaceAccount: isWorkspaceAccountEmail(record.googleEmail),
    capabilities: record.status === 'active'
      ? getGrantedCapabilities(record.grantedScopes)
      : [],
    ...(partialCalendar ? { partialCalendar } : {}),
    connectedAt: record.createdAt.toISOString(),
  }
}

/**
 * Ends a connection without deleting it: the tokens are cleared and the
 * status becomes `revoked`, so the hourly sweep can finish the file
 * cleanup if the caller could not.
 */
export async function markGoogleConnectionRevoked(
  db: DbClient,
  connectionId: string,
): Promise<void> {
  await db
    .update(schema.googleConnections)
    .set({
      status: 'revoked',
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.googleConnections.id, connectionId))
}

/**
 * Deletes a connection row only while it is still `revoked`: a reconnect
 * upserts the same row back to `active`, and that row must survive.
 */
export async function deleteRevokedGoogleConnection(
  db: DbClient,
  connectionId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(schema.googleConnections)
    .where(and(
      eq(schema.googleConnections.id, connectionId),
      eq(schema.googleConnections.status, 'revoked'),
    ))
    .returning({ id: schema.googleConnections.id })

  return deleted.length > 0
}
