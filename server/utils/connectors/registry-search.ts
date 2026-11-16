import type { KVNamespace } from '@cloudflare/workers-types'
import { CONNECTOR_CATEGORIES } from '~~/config/connectors-directory'
import type { ConnectorCategoryId } from '~~/config/connectors-directory'
import { REGISTRY_SEARCH_PAGE_SIZE } from '#shared/utils/connectors-policy'
import {
  countDirectoryCategories,
  directoryUrlKey,
  listCategoryDirectoryEntries,
  listNewDirectoryEntries,
  listTopDirectoryEntries,
  searchDirectoryIndex,
} from '#shared/utils/connectors-directory'
import type {
  DirectoryEntry,
  DirectoryIndex,
} from '#shared/utils/connectors-directory'
import type {
  ConnectorDirectoryHome,
  ConnectorDirectoryItem,
} from '#shared/types/connectors.d'
import { listConnectorUrls } from '~~/server/utils/connectors/store'
import { loadDirectoryIndex } from '~~/server/utils/connectors/directory-index'

export const DIRECTORY_HOME_SECTION_SIZE = 6
export const DIRECTORY_VIEWS = ['all', 'top', 'new'] as const

export type DirectoryView = typeof DIRECTORY_VIEWS[number]

export interface RegistrySearchResult {
  items: ConnectorDirectoryItem[]
  nextCursor: number | null
  total: number | null
  syncing?: true
}

export interface RegistrySearchInput {
  query: string
  cursor: number
  userId: number
  category?: ConnectorCategoryId | null
  view?: DirectoryView
}

type RegistryDatabase = ReturnType<typeof useDb>

/**
 * The user's own connectors by remote address (decrypted in memory; a user
 * has at most 20), so a directory card can say "Added" and open the
 * connector. Only the id of a match ever leaves this function.
 */
export async function loadAddedConnectorIds(
  db: RegistryDatabase,
  userId: number,
): Promise<Map<string, string>> {
  const added = new Map<string, string>()

  for (const connector of await listConnectorUrls(db, userId)) {
    added.set(directoryUrlKey(connector.url), connector.id)
  }

  return added
}

export function toDirectoryItem(
  entry: DirectoryEntry,
  added: ReadonlyMap<string, string>,
): ConnectorDirectoryItem {
  const addedConnectorId = added.get(directoryUrlKey(entry.remoteUrl)) ?? null

  return {
    id: entry.id,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    remoteUrl: entry.remoteUrl,
    host: entry.host,
    authHint: entry.headerNames.length > 0 ? 'header' : 'unknown',
    presetId: entry.presetId,
    publisher: entry.publisher,
    isOfficial: entry.isOfficial,
    isCurated: entry.curatedRank !== null,
    category: entry.category,
    isAdded: addedConnectorId !== null,
    addedConnectorId,
  }
}

function selectEntries(
  index: DirectoryIndex,
  input: RegistrySearchInput,
): DirectoryEntry[] {
  const category = input.category ?? null

  if (input.query) {
    return searchDirectoryIndex(index, input.query, (entry) => {
      return category === null || entry.category === category
    })
  }

  if (input.view === 'top') {
    return listTopDirectoryEntries(index)
  }

  if (input.view === 'new') {
    return listNewDirectoryEntries(index)
  }

  return listCategoryDirectoryEntries(index, category)
}

/**
 * One page of the directory (docs/connectors.md section 10.3): a ranked
 * search when there is a query (optionally inside one category), else the
 * Top or New list, one category, or every entry in the browse order. It
 * reads only the cached directory index, never the registry. An empty
 * mirror answers `syncing: true`. Each item carries the id of the user's
 * own connector for the same address, if any.
 */
export async function searchMcpRegistry(
  db: RegistryDatabase,
  kv: KVNamespace,
  input: RegistrySearchInput,
): Promise<RegistrySearchResult> {
  const index = await loadDirectoryIndex(db, kv)

  if (index.sourceRows === 0 && input.cursor === 0) {
    return { items: [], nextCursor: null, total: 0, syncing: true }
  }

  const entries = selectEntries(index, input)
  const page = entries.slice(
    input.cursor,
    input.cursor + REGISTRY_SEARCH_PAGE_SIZE,
  )
  const nextCursor = input.cursor + REGISTRY_SEARCH_PAGE_SIZE
  const added = page.length > 0
    ? await loadAddedConnectorIds(db, input.userId)
    : new Map<string, string>()

  return {
    items: page.map(entry => toDirectoryItem(entry, added)),
    nextCursor: nextCursor < entries.length ? nextCursor : null,
    total: input.cursor === 0 ? entries.length : null,
  }
}

/**
 * The Discover home: six Top and six New cards, then every category that
 * has entries, in the taxonomy order, with its count and first six cards.
 */
export async function loadMcpRegistryHome(
  db: RegistryDatabase,
  kv: KVNamespace,
  userId: number,
): Promise<ConnectorDirectoryHome> {
  const index = await loadDirectoryIndex(db, kv)
  const added = await loadAddedConnectorIds(db, userId)
  const top = listTopDirectoryEntries(index)
  const newest = listNewDirectoryEntries(index)
  const counts = countDirectoryCategories(index)

  function firstItems(entries: DirectoryEntry[]): ConnectorDirectoryItem[] {
    return entries
      .slice(0, DIRECTORY_HOME_SECTION_SIZE)
      .map(entry => toDirectoryItem(entry, added))
  }

  return {
    top: firstItems(top),
    topCount: top.length,
    new: firstItems(newest),
    newCount: newest.length,
    categories: CONNECTOR_CATEGORIES
      .filter(category => (counts.get(category.id) ?? 0) > 0)
      .map((category) => {
        return {
          id: category.id,
          label: category.label,
          count: counts.get(category.id) ?? 0,
          items: firstItems(listCategoryDirectoryEntries(index, category.id)),
        }
      }),
    total: index.entries.length,
    ...(index.sourceRows === 0 ? { syncing: true as const } : {}),
  }
}

/**
 * One directory entry by id for the detail view, or null when the id is not
 * in the directory (unknown, inactive, filtered out or a duplicate).
 */
export async function findMcpRegistryEntry(
  db: RegistryDatabase,
  kv: KVNamespace,
  id: string,
): Promise<DirectoryEntry | null> {
  const index = await loadDirectoryIndex(db, kv)

  return index.byId.get(id) ?? null
}
