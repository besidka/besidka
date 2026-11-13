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
 * Bytes of unique blobs: a blob counts once per skill however many versions
 * reference it, matching how R2 stores it.
 */
export async function getUserSkillsUsageBytes(
  db: DbClient,
  userId: number,
): Promise<number> {
  const uniqueBlobs = db.selectDistinct({
    skillId: schema.skillFiles.skillId,
    blobSha256: schema.skillFiles.blobSha256,
    bytes: schema.skillFiles.bytes,
  })
    .from(schema.skillFiles)
    .where(eq(schema.skillFiles.userId, userId))
    .as('unique_blobs')
  const [row] = await db.select({
    total: sql<number>`coalesce(sum(${uniqueBlobs.bytes}), 0)`,
  }).from(uniqueBlobs)

  return Number(row?.total ?? 0)
}
