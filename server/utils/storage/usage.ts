import type { SQL } from 'drizzle-orm'
import type {
  StorageBreakdown,
  StorageCategoryUsage,
} from '#shared/types/files.d'
import { sql } from 'drizzle-orm'
import { STORAGE_CATEGORIES } from '~~/server/utils/storage/categories'

function readNumber(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0)
}

/**
 * One scalar expression: the user's bytes across every storage category.
 * Used inside the atomic quota guards of the knowledge ingest, so a guard
 * and `getUserStorageUsageBytes` can never disagree about what counts.
 */
export function userStorageUsedBytesSql(userId: number): SQL<number> {
  const parts = STORAGE_CATEGORIES.map((category) => {
    return category.bytesSql(userId)
  })

  return sql<number>`(${sql.join(parts, sql` + `)})`
}

export async function getUserStorageBreakdown(
  userId: number,
  db: ReturnType<typeof useDb> = useDb(),
): Promise<StorageBreakdown> {
  const columns = STORAGE_CATEGORIES.flatMap((category) => {
    return [
      sql`${category.bytesSql(userId)} as ${sql.raw(`${category.id}_bytes`)}`,
      sql`${category.countSql(userId)} as ${sql.raw(`${category.id}_count`)}`,
    ]
  })
  const [row] = await db.all<Record<string, number>>(
    sql`select ${sql.join(columns, sql`, `)}`,
  )
  const usage = row ?? {}
  const categories: StorageCategoryUsage[] = STORAGE_CATEGORIES.map(
    (category) => {
      return {
        id: category.id,
        bytes: readNumber(usage, `${category.id}_bytes`),
        count: readNumber(usage, `${category.id}_count`),
      }
    },
  )
  const totalBytes = categories.reduce((total, category) => {
    return total + category.bytes
  }, 0)

  return { categories, totalBytes }
}
