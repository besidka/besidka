import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { revokeAllGoogleConnectionsOfUser } from '~~/server/utils/google/tokens'

export interface PurgeGoogleConnectionsResult {
  googleConnectionsDeleted: number
}

type PurgeGoogleConnectionsDatabase = Pick<
  ReturnType<typeof useDb>,
  'delete' | 'select'
>

/**
 * Deletes a user's `google_connections` rows, which have no foreign key to
 * `users` and so never cascade. Before the delete, every stored grant is
 * revoked at Google through `revokeAllGoogleConnectionsOfUser`, one at a
 * time under a ten-second deadline; that step never throws, so Google's
 * answer never blocks the account deletion. The user's copies of Google
 * files are removed with the rest of their `files` rows.
 */
export async function purgeUserGoogleConnections(
  userId: number,
  database: PurgeGoogleConnectionsDatabase,
  options: {
    logger?: LoggerLike
    revoke?: typeof revokeAllGoogleConnectionsOfUser
  } = {},
): Promise<PurgeGoogleConnectionsResult> {
  const revoke = options.revoke ?? revokeAllGoogleConnectionsOfUser
  const revocation = await revoke(database, userId)

  options.logger?.set({
    attributes: {
      googlePurge: {
        revokeAttempted: revocation.attempted,
        revoked: revocation.revoked,
      },
    },
  })

  const googleConnections = await database
    .delete(schema.googleConnections)
    .where(eq(schema.googleConnections.userId, userId))
    .returning({ id: schema.googleConnections.id })

  return {
    googleConnectionsDeleted: googleConnections.length,
  }
}
