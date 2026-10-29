import { createRequestLogger } from 'evlog'
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const OAUTH_GRANT_RETENTION_DAYS = 1
export const OAUTH_OWNERLESS_CLIENT_RETENTION_DAYS = 7
export const OAUTH_SWEEP_BATCH_SIZE = 100
export const OAUTH_SWEEP_MAX_BATCHES = 10

const OAUTH_GRANT_SWEEP_CRON = '0 * * * *'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunOAuthGrantSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  db?: ReturnType<typeof useDb>
}

interface OAuthGrantSweepCounts {
  accessTokens: number
  refreshTokens: number
  clients: number
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== OAUTH_GRANT_SWEEP_CRON) {
      return
    }

    await runOAuthGrantSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

async function sweepExpiredAccessTokens(
  db: ReturnType<typeof useDb>,
  cutoff: Date,
): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < OAUTH_SWEEP_MAX_BATCHES; batch++) {
    const rows = await db.delete(schema.oauthAccessTokens)
      .where(inArray(
        schema.oauthAccessTokens.id,
        db.select({ id: schema.oauthAccessTokens.id })
          .from(schema.oauthAccessTokens)
          .where(lt(schema.oauthAccessTokens.expiresAt, cutoff))
          .orderBy(asc(schema.oauthAccessTokens.id))
          .limit(OAUTH_SWEEP_BATCH_SIZE),
      ))
      .returning({ id: schema.oauthAccessTokens.id })

    deleted += rows.length

    if (rows.length < OAUTH_SWEEP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}

async function sweepStaleRefreshTokens(
  db: ReturnType<typeof useDb>,
  cutoff: Date,
): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < OAUTH_SWEEP_MAX_BATCHES; batch++) {
    const staleRefreshTokenIds = db
      .select({ id: schema.oauthRefreshTokens.id })
      .from(schema.oauthRefreshTokens)
      .where(or(
        lt(schema.oauthRefreshTokens.expiresAt, cutoff),
        and(
          isNotNull(schema.oauthRefreshTokens.revoked),
          lt(schema.oauthRefreshTokens.revoked, cutoff),
        ),
      ))
      .orderBy(asc(schema.oauthRefreshTokens.id))
      .limit(OAUTH_SWEEP_BATCH_SIZE)
    const [, refreshTokens] = await db.batch([
      db.delete(schema.oauthAccessTokens)
        .where(inArray(
          schema.oauthAccessTokens.refreshId,
          staleRefreshTokenIds,
        ))
        .returning({ id: schema.oauthAccessTokens.id }),
      db.delete(schema.oauthRefreshTokens)
        .where(inArray(schema.oauthRefreshTokens.id, staleRefreshTokenIds))
        .returning({ id: schema.oauthRefreshTokens.id }),
    ])

    deleted += refreshTokens.length

    if (refreshTokens.length < OAUTH_SWEEP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}

async function sweepOwnerlessClients(
  db: ReturnType<typeof useDb>,
  cutoff: Date,
): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < OAUTH_SWEEP_MAX_BATCHES; batch++) {
    const staleClients = await db
      .select({ id: schema.oauthClients.id })
      .from(schema.oauthClients)
      .where(and(
        isNull(schema.oauthClients.userId),
        lt(schema.oauthClients.createdAt, cutoff),
        notExists(
          db.select({ one: sql`1` })
            .from(schema.oauthConsents)
            .where(eq(
              schema.oauthConsents.clientId,
              schema.oauthClients.clientId,
            )),
        ),
        notExists(
          db.select({ one: sql`1` })
            .from(schema.oauthRefreshTokens)
            .where(eq(
              schema.oauthRefreshTokens.clientId,
              schema.oauthClients.clientId,
            )),
        ),
        notExists(
          db.select({ one: sql`1` })
            .from(schema.oauthAccessTokens)
            .where(eq(
              schema.oauthAccessTokens.clientId,
              schema.oauthClients.clientId,
            )),
        ),
      ))
      .orderBy(asc(schema.oauthClients.id))
      .limit(OAUTH_SWEEP_BATCH_SIZE)

    if (!staleClients.length) {
      break
    }

    const rows = await db.delete(schema.oauthClients)
      .where(inArray(
        schema.oauthClients.id,
        staleClients.map((client) => {
          return client.id
        }),
      ))
      .returning({ id: schema.oauthClients.id })

    deleted += rows.length

    if (staleClients.length < OAUTH_SWEEP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}

/**
 * Deletes OAuth rows that carry no value after their expiry: access tokens
 * expired for a day, refresh tokens expired or revoked for a day, and
 * owner-less dynamically registered clients older than a week with no
 * consent and no token. Access tokens that reference a stale refresh token
 * go first, in the same batch, because of the `refresh_id` foreign key.
 * Every statement is bounded by a batch size and a batch count so one run
 * stays inside the D1 limits; a backlog drains over the following hours.
 */
export async function runOAuthGrantSweepJob(
  input: RunOAuthGrantSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/oauth-grant-sweep',
    requestId: `oauth-grant-sweep-${input.controller.scheduledTime}`,
  })
  const grantCutoff = new Date(
    input.controller.scheduledTime
    - OAUTH_GRANT_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  )
  const clientCutoff = new Date(
    input.controller.scheduledTime
    - OAUTH_OWNERLESS_CLIENT_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  )
  const counts: OAuthGrantSweepCounts = {
    accessTokens: 0,
    refreshTokens: 0,
    clients: 0,
  }
  let status = 200

  logger.set({
    attributes: {
      oauthSweep: {
        cron: input.controller.cron,
        scheduledTime: new Date(input.controller.scheduledTime).toISOString(),
        grantCutoff: grantCutoff.toISOString(),
        clientCutoff: clientCutoff.toISOString(),
      },
    },
  })

  try {
    const db = input.db || useDb()

    counts.accessTokens = await sweepExpiredAccessTokens(db, grantCutoff)
    counts.refreshTokens = await sweepStaleRefreshTokens(db, grantCutoff)
    counts.clients = await sweepOwnerlessClients(db, clientCutoff)
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        oauthSweep: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  logger.set({
    attributes: {
      oauthSweep: {
        deletedAccessTokens: counts.accessTokens,
        deletedRefreshTokens: counts.refreshTokens,
        deletedClients: counts.clients,
      },
    },
  })

  logger.emit({ status })
}
