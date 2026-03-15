import { sql } from 'drizzle-orm'

export function escapeLikePattern(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

export function containsLikeEscaped(
  column: unknown,
  value: string,
) {
  const pattern = `%${escapeLikePattern(value)}%`

  return sql`${column} like ${pattern} escape '\\'`
}
