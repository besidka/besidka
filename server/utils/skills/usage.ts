import type { SQL } from 'drizzle-orm'
import { count, eq, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export async function countUserSkills(
  db: DbClient,
  userId: number,
): Promise<number> {
  const [row] = await db.select({ total: count() })
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))

  return row?.total ?? 0
}

/**
 * One scalar expression: bytes of unique blobs, a blob counting once per
 * skill however many versions reference it, matching how R2 stores it. This
 * is the skills category of the shared storage allowance, so the breakdown
 * and every skill write guard read the same number.
 */
export function userSkillsBytesSql(userId: number): SQL<number> {
  return sql<number>`(
    select coalesce(sum(unique_blobs.bytes), 0) from (
      select distinct
        ${schema.skillFiles.skillId} as skill_id,
        ${schema.skillFiles.blobSha256} as blob_sha256,
        ${schema.skillFiles.bytes} as bytes
      from ${schema.skillFiles}
      where ${schema.skillFiles.userId} = ${userId}
    ) as unique_blobs
  )`
}

export function userSkillsCountSql(userId: number): SQL<number> {
  return sql<number>`(
    select count(*) from ${schema.skills}
    where ${eq(schema.skills.userId, userId)}
  )`
}
