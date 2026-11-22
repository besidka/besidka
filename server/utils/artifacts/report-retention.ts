import { and, asc, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export const ARTIFACT_REPORT_RETENTION_MONTHS = 12
export const ARTIFACT_COPYRIGHT_REMOVAL_RETENTION_MONTHS = 24
export const ARTIFACT_REPORT_SWEEP_BATCH_SIZE = 100
export const ARTIFACT_REPORT_SWEEP_MAX_BATCHES = 10

function monthsBefore(date: Date, months: number): Date {
  const cutoff = new Date(date)

  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)

  return cutoff
}

function closedAtSql() {
  return sql`coalesce(
    ${schema.artifactReports.resolvedAt},
    ${schema.artifactReports.decidedAt}
  )`
}

function isCopyrightRemoval() {
  return sql`(
    ${schema.artifactReports.reason} = 'copyright'
    and coalesce(${schema.artifactReports.decision}, '') = 'removed'
  )`
}

/**
 * Deletes closed `artifact_reports` rows once their retention ends: 12
 * months after closing, 24 months for a copyright removal (Privacy Policy,
 * Art. 30 row 14a). Open reports and reports of an artifact under a legal
 * hold are kept. Each run is bounded; a backlog drains over the next runs.
 */
export async function sweepClosedArtifactReports(input: {
  db: DbClient
  now: Date
}): Promise<number> {
  const standardCutoff = monthsBefore(
    input.now,
    ARTIFACT_REPORT_RETENTION_MONTHS,
  )
  const copyrightCutoff = monthsBefore(
    input.now,
    ARTIFACT_COPYRIGHT_REMOVAL_RETENTION_MONTHS,
  )
  const heldArtifactIds = input.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(sql`${schema.artifacts.legalHoldUntil} > ${
      Math.floor(input.now.getTime() / 1000)
    }`)
  const expired = and(
    ne(schema.artifactReports.status, 'open'),
    or(
      isNotNull(schema.artifactReports.resolvedAt),
      isNotNull(schema.artifactReports.decidedAt),
    ),
    or(
      and(
        sql`not (${isCopyrightRemoval()})`,
        lt(closedAtSql(), Math.floor(standardCutoff.getTime() / 1000)),
      ),
      and(
        isCopyrightRemoval(),
        lt(closedAtSql(), Math.floor(copyrightCutoff.getTime() / 1000)),
      ),
    ),
    sql`${schema.artifactReports.artifactId} not in ${heldArtifactIds}`,
  )
  let deleted = 0

  for (
    let batch = 0;
    batch < ARTIFACT_REPORT_SWEEP_MAX_BATCHES;
    batch++
  ) {
    const rows = await input.db.delete(schema.artifactReports)
      .where(inArray(
        schema.artifactReports.id,
        input.db.select({ id: schema.artifactReports.id })
          .from(schema.artifactReports)
          .where(expired)
          .orderBy(asc(schema.artifactReports.id))
          .limit(ARTIFACT_REPORT_SWEEP_BATCH_SIZE),
      ))
      .returning({ id: schema.artifactReports.id })

    deleted += rows.length

    if (rows.length < ARTIFACT_REPORT_SWEEP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}
