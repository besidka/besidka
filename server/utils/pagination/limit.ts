export function parsePaginationLimit(
  limit: string | undefined,
  defaultLimit: number,
  maxLimit: number,
) {
  if (!limit) {
    return defaultLimit
  }

  const parsedLimit = Number.parseInt(limit, 10)

  if (Number.isNaN(parsedLimit)) {
    return defaultLimit
  }

  return Math.min(Math.max(parsedLimit, 1), maxLimit)
}
