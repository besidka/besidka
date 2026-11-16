import { and, asc, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  CONNECTOR_PRESETS,
  findConnectorPresetByUrl,
} from '~~/config/connectors-catalog'
import {
  REGISTRY_SEARCH_MAX_CURSOR,
  REGISTRY_SEARCH_PAGE_SIZE,
} from '#shared/utils/connectors-policy'
import { deriveConnectorPublisher } from '#shared/utils/connectors-publisher'
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
  publisher: string | null
  isAdded: boolean
}

export interface RegistrySearchResult {
  items: RegistrySearchItem[]
  nextCursor: number | null
  total: number | null
  syncing?: true
}

export interface RegistrySearchInput {
  query: string
  cursor: number
  userId: number
}

const FEATURED_PRESET_URLS: string[] = CONNECTOR_PRESETS.map((preset) => {
  return preset.url
})

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

function normalizeUrl(url: string): string | null {
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

/**
 * The remote URLs among `remoteUrls` that the user already has a connector
 * for, compared by full URL (decrypted, in memory only; nothing is returned
 * but which of the given URLs matched). The plain `origin` column narrows
 * the rows first, so at most a handful are decrypted.
 */
async function findAddedUrls(
  db: ReturnType<typeof useDb>,
  userId: number,
  remoteUrls: readonly string[],
): Promise<Set<string>> {
  const wanted = new Map<string, string>()

  for (const remoteUrl of remoteUrls) {
    const normalized = normalizeUrl(remoteUrl)

    if (normalized) {
      wanted.set(normalized, new URL(normalized).origin)
    }
  }

  if (wanted.size === 0) {
    return new Set()
  }

  const rows = await db.select({
    urlEncrypted: schema.connectors.urlEncrypted,
  })
    .from(schema.connectors)
    .where(and(
      eq(schema.connectors.userId, userId),
      inArray(schema.connectors.origin, [...new Set(wanted.values())]),
    ))
  const added = new Set<string>()

  for (const row of rows) {
    const url = normalizeUrl(await useDecryptText(row.urlEncrypted))

    if (url && wanted.has(url)) {
      added.add(url)
    }
  }

  return added
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
    publisher: deriveConnectorPublisher(row.name),
    isAdded: false,
  }
}

function buildSearchCondition(query: string): SQL | undefined {
  const { name, title, description, status } = schema.mcpRegistryServers

  if (!query) {
    return and(
      eq(status, 'active'),
      notInArray(schema.mcpRegistryServers.remoteUrl, FEATURED_PRESET_URLS),
    )
  }

  return and(
    eq(status, 'active'),
    or(
      containsLikeEscaped(name, query),
      containsLikeEscaped(title, query),
      containsLikeEscaped(description, query),
    ),
  )
}

function buildOrdering(query: string, escapedQuery: string): SQL[] {
  const { name, title } = schema.mcpRegistryServers
  const alphabetical = [
    asc(sql`lower(coalesce(${title}, ${name}))`),
    asc(name),
    asc(schema.mcpRegistryServers.id),
  ]

  if (!query) {
    return [
      asc(sql`CASE
        WHEN ${title} IS NULL THEN 2
        WHEN ${title} GLOB '[A-Za-z]*' THEN 0
        ELSE 1
      END`),
      ...alphabetical,
    ]
  }

  return [buildRanking(query, escapedQuery), ...alphabetical]
}

/**
 * Lists or searches the local copy of the registry only. An empty query is
 * the browse mode: entries without the four featured presets, those with a
 * title first (the registry has no popularity data, so a curated title is the
 * only quality proxy) and a letter-first title before one that starts with a
 * digit or symbol, then alphabetical regardless of case. A query runs
 * `LIKE` with an explicit `ESCAPE` clause and the user's `%`, `_` and `\` are
 * escaped, so it is always a literal substring. Ranking: exact name (or
 * last name segment), exact title, prefix, substring in name or title, then
 * description-only matches; ties by title and name. The first page also
 * answers the total count. An empty table on the first page answers
 * `syncing: true`, so the UI can say the directory is being prepared. Each
 * item says whether the user already has a connector for its exact URL.
 */
export async function searchMcpRegistry(
  db: ReturnType<typeof useDb>,
  input: RegistrySearchInput,
): Promise<RegistrySearchResult> {
  const { name, title, description } = schema.mcpRegistryServers
  const escapedQuery = escapeLikePattern(input.query)
  const condition = buildSearchCondition(input.query)
  const rows = await db.select({
    id: schema.mcpRegistryServers.id,
    name,
    title,
    description,
    remoteUrl: schema.mcpRegistryServers.remoteUrl,
    headerNames: schema.mcpRegistryServers.headerNames,
  })
    .from(schema.mcpRegistryServers)
    .where(condition)
    .orderBy(...buildOrdering(input.query, escapedQuery))
    .limit(REGISTRY_SEARCH_PAGE_SIZE + 1)
    .offset(input.cursor)

  if (rows.length === 0 && input.cursor === 0) {
    const [anyRow] = await db.select({ id: schema.mcpRegistryServers.id })
      .from(schema.mcpRegistryServers)
      .limit(1)

    if (!anyRow) {
      return { items: [], nextCursor: null, total: 0, syncing: true }
    }
  }

  const nextCursor = input.cursor + REGISTRY_SEARCH_PAGE_SIZE
  const hasMore = rows.length > REGISTRY_SEARCH_PAGE_SIZE
    && nextCursor <= REGISTRY_SEARCH_MAX_CURSOR
  const items = rows.slice(0, REGISTRY_SEARCH_PAGE_SIZE).map(toItem)
  const added = await findAddedUrls(
    db,
    input.userId,
    items.map(item => item.remoteUrl),
  )
  let total: number | null = null

  if (input.cursor === 0) {
    const [row] = await db.select({ total: count() })
      .from(schema.mcpRegistryServers)
      .where(condition)

    total = row?.total ?? 0
  }

  return {
    items: items.map((item) => {
      const normalized = normalizeUrl(item.remoteUrl)

      return { ...item, isAdded: !!normalized && added.has(normalized) }
    }),
    nextCursor: hasMore ? nextCursor : null,
    total,
  }
}
