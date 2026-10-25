import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const MAX_IDS_PER_STATEMENT = 90

function isInternalId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function groupIds(ids: number[]): number[][] {
  const groups: number[][] = []

  for (let start = 0; start < ids.length; start += MAX_IDS_PER_STATEMENT) {
    groups.push(ids.slice(start, start + MAX_IDS_PER_STATEMENT))
  }

  return groups
}

/**
 * Bumps `knowledge_version` by one for every listed project, so the next
 * pack build picks up the change. The column is nullable without a default,
 * hence the `coalesce`. Ids are internal integers matched with raw SQL (the
 * `projects.id` column type would hash-decode them), sent in groups that stay
 * under the D1 bound-parameter limit and awaited one group at a time.
 * Ownership is the caller's job: this function takes project ids only.
 */
export async function bumpKnowledgeVersion(
  projectIds: number[],
): Promise<void> {
  const uniqueIds = [...new Set(projectIds.filter(isInternalId))]

  if (uniqueIds.length === 0) {
    return
  }

  const db = useDb()

  for (const group of groupIds(uniqueIds)) {
    const idList = sql.join(
      group.map((projectId) => {
        return sql`${projectId}`
      }),
      sql`, `,
    )

    await db
      .update(schema.projects)
      .set({
        knowledgeVersion: sql`coalesce(${schema.projects.knowledgeVersion}, 0) + 1`,
      })
      .where(sql`${schema.projects.id} in (${idList})`)
  }
}
