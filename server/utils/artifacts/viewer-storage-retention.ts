import { ARTIFACT_STORAGE_VIEWER_RETENTION_DAYS } from '#shared/utils/artifacts'
import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

const DAY_SECONDS = 24 * 60 * 60
const NEVER_ENDS = 253402300799

export interface SweepViewerArtifactStorageInput {
  db: DbClient
  now?: Date
}

/**
 * Enforces the saved-progress retention of the Privacy Policy (A-9) for
 * people who view someone else's artifact: their rows go at once when the
 * artifact is taken down, when the artifact no longer exists, and 30 days
 * after the last share link to it ended (revoked, expired or taken down,
 * whichever came first per link). The owner's own rows are kept until
 * Reset, artifact deletion or account deletion. Runs on the hourly cron.
 */
export async function sweepViewerArtifactStorage(
  input: SweepViewerArtifactStorageInput,
): Promise<number> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const cutoffSeconds = nowSeconds
    - ARTIFACT_STORAGE_VIEWER_RETENTION_DAYS * DAY_SECONDS
  const storage = schema.artifactStorage
  const artifacts = schema.artifacts
  const shares = schema.artifactShares

  const shareEndedAt = sql`min(
    coalesce(${shares.revokedAt}, ${NEVER_ENDS}),
    coalesce(${shares.takedownAt}, ${NEVER_ENDS}),
    coalesce(${shares.expiresAt}, ${NEVER_ENDS})
  )`

  const deleted = await input.db
    .delete(storage)
    .where(sql`not exists (
      select 1 from ${artifacts}
      where ${artifacts.id} = ${storage.artifactId}
        and ${artifacts.userId} = ${storage.viewerUserId}
    ) and (
      not exists (
        select 1 from ${artifacts}
        where ${artifacts.id} = ${storage.artifactId}
          and ${artifacts.takedownAt} is null
      )
      or (
        not exists (
          select 1 from ${shares}
          where ${shares.artifactId} = ${storage.artifactId}
            and ${shareEndedAt} > ${nowSeconds}
        )
        and coalesce((
          select max(${shareEndedAt}) from ${shares}
          where ${shares.artifactId} = ${storage.artifactId}
        ), 0) <= ${cutoffSeconds}
      )
    )`)
    .returning({ artifactId: storage.artifactId })

  return deleted.length
}
