import { and, asc, eq, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { findConnectorPresetByUrl } from '~~/config/connectors-catalog'
import { REGISTRY_SEARCH_PAGE_SIZE } from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  containsLikeEscaped,
  escapeLikePattern,
} from '~~/server/utils/db/like'

export type RegistryAuthHint = 'header' | 'unknown'

export interface RegistrySearchItem {
  id: string
  name: string
  title: string | null
  description: string
  remoteUrl: string
  transport: 'streamable-http'
  authHint: RegistryAuthHint
  presetId: string | null
}

export interface RegistrySearchResult {
  items: RegistrySearchItem[]
  nextCursor: number | null
  syncing?: true
}

export interface RegistrySearchInput {
  query: string
  cursor: number
}

function likeClause(column: unknown, pattern: string) {
  return sql`${column} like ${pattern} escape '\\'`
}

function buildRanking(query: string, escapedQuery: string): SQL {
  const { name, title } = schema.mcpRegistryServers
  const lowered = query.toLowerCase()

  return sql`CASE
    WHEN lower(${name}) = ${lowered}
      OR ${likeClause(name, `%/${escapedQuery}`)} THEN 0
    WHEN lower(${title}) = ${lowered} THEN 1
    WHEN ${likeClause(title, `${escapedQuery}%`)}
      OR ${likeClause(name, `${escapedQuery}%`)}
      OR ${likeClause(name, `%/${escapedQuery}%`)} THEN 2
    WHEN ${likeClause(title, `%${escapedQuery}%`)}
      OR ${likeClause(name, `%${escapedQuery}%`)} THEN 3
    ELSE 4
  END`
}

function toItem(row: {
  id: string
  name: string
  title: string | null
  description: string
  remoteUrl: string
  headerNames: string[]
}): RegistrySearchItem {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    remoteUrl: row.remoteUrl,
    transport: 'streamable-http',
    authHint: row.headerNames.length > 0 ? 'header' : 'unknown',
    presetId: findConnectorPresetByUrl(row.remoteUrl)?.id ?? null,
  }
}

/**
 * Searches the local copy of the registry only. `LIKE` runs with an explicit
 * `ESCAPE` clause and the user's `%`, `_` and `\` are escaped, so a query is
 * always a literal substring. Ranking: exact name (or last name segment),
 * exact title, prefix, substring in name or title, then description-only
 * matches; ties by title and name. An empty table on the first page answers
 * `syncing: true`, so the UI can say the directory is being prepared.
 */
export async function searchMcpRegistry(
  db: ReturnType<typeof useDb>,
  input: RegistrySearchInput,
): Promise<RegistrySearchResult> {
  const { name, title, description, status } = schema.mcpRegistryServers
  const escapedQuery = escapeLikePattern(input.query)
  const rows = await db.select({
    id: schema.mcpRegistryServers.id,
    name,
    title,
    description,
    remoteUrl: schema.mcpRegistryServers.remoteUrl,
    headerNames: schema.mcpRegistryServers.headerNames,
  })
    .from(schema.mcpRegistryServers)
    .where(and(
      eq(status, 'active'),
      or(
        containsLikeEscaped(name, input.query),
        containsLikeEscaped(title, input.query),
        containsLikeEscaped(description, input.query),
      ),
    ))
    .orderBy(
      buildRanking(input.query, escapedQuery),
      asc(sql`coalesce(${title}, ${name})`),
      asc(name),
      asc(schema.mcpRegistryServers.id),
    )
    .limit(REGISTRY_SEARCH_PAGE_SIZE + 1)
    .offset(input.cursor)

  if (rows.length === 0 && input.cursor === 0) {
    const [anyRow] = await db.select({ id: schema.mcpRegistryServers.id })
      .from(schema.mcpRegistryServers)
      .limit(1)

    if (!anyRow) {
      return { items: [], nextCursor: null, syncing: true }
    }
  }

  const hasMore = rows.length > REGISTRY_SEARCH_PAGE_SIZE

  return {
    items: rows.slice(0, REGISTRY_SEARCH_PAGE_SIZE).map(toItem),
    nextCursor: hasMore ? input.cursor + REGISTRY_SEARCH_PAGE_SIZE : null,
  }
}
