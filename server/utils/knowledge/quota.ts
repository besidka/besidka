import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export function userKnowledgeTextBytesSql(userId: number): SQL<number> {
  return sql<number>`(
    select coalesce(sum(${schema.projectKnowledgeItems.textBytes}), 0)
    from ${schema.projectKnowledgeItems}
    where ${eq(schema.projectKnowledgeItems.userId, userId)}
  )`
}

export async function getUserKnowledgeTextBytes(
  userId: number,
): Promise<number> {
  const db = useDb()
  const result = await db
    .select({
      used: sql<number>`coalesce(
        sum(${schema.projectKnowledgeItems.textBytes}), 0
      )`,
    })
    .from(schema.projectKnowledgeItems)
    .where(eq(schema.projectKnowledgeItems.userId, userId))
    .get()

  return result?.used ?? 0
}
