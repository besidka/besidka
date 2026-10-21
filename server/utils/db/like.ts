import { or, sql } from 'drizzle-orm'

export function escapeLikePattern(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

export function getLikeCaseVariants(value: string) {
  const trimmedValue = value.trim()
  const [firstCharacter = '', ...restCharacters] = Array.from(trimmedValue)
  const capitalized = firstCharacter.toUpperCase()
    + restCharacters.join('').toLowerCase()

  return Array.from(new Set([
    trimmedValue,
    trimmedValue.toLowerCase(),
    trimmedValue.toUpperCase(),
    capitalized,
  ]))
}

export function containsLikeEscaped(
  column: unknown,
  value: string,
) {
  const conditions = getLikeCaseVariants(value).map((variant) => {
    const pattern = `%${escapeLikePattern(variant)}%`

    return sql`${column} like ${pattern} escape '\\'`
  })

  if (conditions.length === 1) {
    return conditions[0]
  }

  return or(...conditions)
}
