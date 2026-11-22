import { and, asc, eq } from 'drizzle-orm'
import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { checkGoogleByoAccess } from '~~/server/utils/google/byo-access'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import type { GoogleFetchOptions } from '~~/server/utils/google/http'

export const GOOGLE_BYO_GATE_SWEEP_LIMIT = 25

export interface GoogleByoGateSweepResult {
  checked: number
  ended: number
  failed: number
}

/**
 * Ends the bring-your-own connections of users who no longer pass the
 * admin and `google.byo` gate (an admin who lost the role or 2FA, the flag
 * turned off or killed, or the Labs opt-in withdrawn). Each one is
 * disconnected like a Disconnect: the grant is revoked at Google (no client
 * secret needed), the tokens are cleared and the access-ended cleanup
 * runs. Without this, such a row would stay `active` with a restricted-scope
 * refresh token nobody may use. A gate check that cannot run (KV or D1
 * down) leaves the row alone; at most 25 rows per run, least recently
 * updated first, one at a time.
 */
export async function endUngatedGoogleByoConnections(input: {
  db: ReturnType<typeof useDb>
  kv: KVNamespace
  logger: LoggerLike
  storage?: Pick<R2Bucket, 'delete'>
  fetchOptions?: GoogleFetchOptions
  limit?: number
}): Promise<GoogleByoGateSweepResult> {
  const connections = schema.googleConnections
  const result: GoogleByoGateSweepResult = { checked: 0, ended: 0, failed: 0 }
  const rows = await input.db
    .select({ userId: connections.userId })
    .from(connections)
    .where(and(
      eq(connections.clientMode, 'byo'),
      eq(connections.status, 'active'),
    ))
    .orderBy(asc(connections.updatedAt))
    .limit(input.limit ?? GOOGLE_BYO_GATE_SWEEP_LIMIT)

  for (const row of rows) {
    result.checked += 1

    try {
      const verdict = await checkGoogleByoAccess({
        db: input.db,
        userId: row.userId,
        kv: input.kv,
      })

      if (verdict === 'allowed') {
        continue
      }

      await disconnectGoogleConnection({
        db: input.db,
        userId: row.userId,
        clientMode: 'byo',
        logger: input.logger,
        storage: input.storage,
        fetchOptions: input.fetchOptions,
      })
      result.ended += 1
    } catch (exception) {
      input.logger.set({
        attributes: {
          googleByoGateSweep: {
            userId: row.userId,
            error: exception instanceof Error ? exception.name : 'unknown',
          },
        },
      })
      result.failed += 1
    }
  }

  return result
}
