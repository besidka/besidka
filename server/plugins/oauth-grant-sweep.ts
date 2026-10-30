import { createRequestLogger } from 'evlog'
import {
  and,
  asc,
  eq,
  gt,
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
import { OAUTH_REFRESH_TOKEN_TTL_SECONDS } from '~~/server/utils/oauth/token-ttl'

export const OAUTH_GRANT_RETENTION_DAYS = 1
export const OAUTH_OWNERLESS_CLIENT_RETENTION_DAYS = 7
export const OAUTH_SWEEP_BATCH_SIZE = 100
export const OAUTH_SWEEP_MAX_BATCHES = 10

/**
 * Owner-less client deletes bind one parameter per id, and D1 allows about
 * 100 bound parameters per statement, so this stays well below the shared
 * batch size.
 */
export const OAUTH_SWEEP_CLIENT_BATCH_SIZE = 50

const OAUTH_GRANT_SWEEP_CRON = '0 * * * *'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MILLISECONDS_PER_SECOND = 1000

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
  consents: number
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

async function sweepDeadConsents(
  db: ReturnType<typeof useDb>,
  consentCutoff: Date,
  now: Date,
): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < OAUTH_SWEEP_MAX_BATCHES; batch++) {
    const rows = await db.delete(schema.oauthConsents)
      .where(inArray(
        schema.oauthConsents.id,
        db.select({ id: schema.oauthConsents.id })
          .from(schema.oauthConsents)
          .where(and(
            isNotNull(schema.oauthConsents.userId),
            lt(schema.oauthConsents.updatedAt, consentCutoff),
            notExists(
              db.select({ one: sql`1` })
                .from(schema.oauthRefreshTokens)
                .where(and(
                  eq(
                    schema.oauthRefreshTokens.userId,
                    schema.oauthConsents.userId,
                  ),
                  eq(
                    schema.oauthRefreshTokens.clientId,
                    schema.oauthConsents.clientId,
                  ),
                  isNull(schema.oauthRefreshTokens.revoked),
                  gt(schema.oauthRefreshTokens.expiresAt, now),
                )),
            ),
            notExists(
              db.select({ one: sql`1` })
                .from(schema.oauthAccessTokens)
                .where(and(
                  eq(
                    schema.oauthAccessTokens.userId,
                    schema.oauthConsents.userId,
                  ),
                  eq(
                    schema.oauthAccessTokens.clientId,
                    schema.oauthConsents.clientId,
                  ),
                  isNull(schema.oauthAccessTokens.revoked),
                  gt(schema.oauthAccessTokens.expiresAt, now),
                )),
            ),
          ))
          .orderBy(asc(schema.oauthConsents.id))
          .limit(OAUTH_SWEEP_BATCH_SIZE),
      ))
      .returning({ id: schema.oauthConsents.id })

    deleted += rows.length

    if (rows.length < OAUTH_SWEEP_BATCH_SIZE) {
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
      .limit(OAUTH_SWEEP_CLIENT_BATCH_SIZE)

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

    if (staleClients.length < OAUTH_SWEEP_CLIENT_BATCH_SIZE) {
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
 * Consents go once the user has no live refresh token and no live opaque
 * access token for that client and the consent's `updated_at` is older than
 * the refresh token lifetime (`OAUTH_REFRESH_TOKEN_TTL_SECONDS`, 30 days).
 * The `updated_at` test is what keeps an app that never asked for
 * `offline_access` alive: its JWT access tokens are not stored, so
 * `resolveMcpPrincipal` bumps `updated_at` on every verified `/mcp` call
 * (throttled to once per 15 minutes) and a connection in use never ages out.
 * A consent that old with no live token is dead weight: nothing lists it, and
 * a later authorization would skip the approval screen while it still covers
 * the requested scopes. The sweep runs the consent step before the owner-less
 * clients one because a consent keeps its client alive. Every statement is
 * bounded by a batch size and a batch count so one run stays inside the D1
 * limits; a backlog drains over the following hours.
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
  const consentCutoff = new Date(
    input.controller.scheduledTime
    - OAUTH_REFRESH_TOKEN_TTL_SECONDS * MILLISECONDS_PER_SECOND,
  )
  const clientCutoff = new Date(
    input.controller.scheduledTime
    - OAUTH_OWNERLESS_CLIENT_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  )
  const counts: OAuthGrantSweepCounts = {
    accessTokens: 0,
    refreshTokens: 0,
    consents: 0,
    clients: 0,
  }
  let status = 200

  logger.set({
    attributes: {
      oauthSweep: {
        cron: input.controller.cron,
        scheduledTime: new Date(input.controller.scheduledTime).toISOString(),
        grantCutoff: grantCutoff.toISOString(),
        consentCutoff: consentCutoff.toISOString(),
        clientCutoff: clientCutoff.toISOString(),
      },
    },
  })

  let db: ReturnType<typeof useDb> | null = null

  try {
    db = input.db || useDb()

    counts.accessTokens = await sweepExpiredAccessTokens(db, grantCutoff)
    counts.refreshTokens = await sweepStaleRefreshTokens(db, grantCutoff)
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

  if (db) {
    try {
      counts.consents = await sweepDeadConsents(
        db,
        consentCutoff,
        new Date(input.controller.scheduledTime),
      )
    } catch (exception) {
      logger.set({
        attributes: {
          oauthSweep: {
            consentsError: exceptionMessage(exception),
          },
        },
      })
    }

    try {
      counts.clients = await sweepOwnerlessClients(db, clientCutoff)
    } catch (exception) {
      logger.set({
        attributes: {
          oauthSweep: {
            clientsError: exceptionMessage(exception),
          },
        },
      })
    }
  }

  logger.set({
    attributes: {
      oauthSweep: {
        deletedAccessTokens: counts.accessTokens,
        deletedRefreshTokens: counts.refreshTokens,
        deletedConsents: counts.consents,
        deletedClients: counts.clients,
      },
    },
  })

  logger.emit({ status })
}
