import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export interface PurgeGoogleConnectionsResult {
  googleConnectionsDeleted: number
}

type PurgeGoogleConnectionsDatabase = Pick<ReturnType<typeof useDb>, 'delete'>

/**
 * Deletes a user's `google_connections` rows, which have no foreign key to
 * `users` and so never cascade. Rows only: revoking the tokens at Google
 * belongs to the connection flow and is not done here, and the user's copies
 * of Google files are removed with the rest of their `files` rows.
 */
export async function purgeUserGoogleConnections(
  userId: number,
  database: PurgeGoogleConnectionsDatabase,
): Promise<PurgeGoogleConnectionsResult> {
  const googleConnections = await database
    .delete(schema.googleConnections)
    .where(eq(schema.googleConnections.userId, userId))
    .returning({ id: schema.googleConnections.id })

  return {
    googleConnectionsDeleted: googleConnections.length,
  }
}
