import {
  CONNECTOR_CATEGORIES,
  CURATED_CONNECTORS,
  EPHEMERAL_TUNNEL_SUFFIXES,
  OTHER_CONNECTOR_CATEGORY_ID,
} from '~~/config/connectors-directory'
import type {
  ConnectorCategoryId,
  CuratedConnector,
} from '~~/config/connectors-directory'
import {
  CONNECTOR_PRESETS,
  findConnectorPresetByUrl,
} from '~~/config/connectors-catalog'
import type { ConnectorPreset } from '~~/config/connectors-catalog'
import { deriveConnectorPublisher } from '#shared/utils/connectors-publisher'

export const DIRECTORY_MIN_DESCRIPTION_LENGTH = 20
export const DIRECTORY_PRESET_ID_PREFIX = 'preset:'
export const DIRECTORY_MIN_INFIX_LENGTH = 3

const TITLE_WEIGHT = 3
const DESCRIPTION_WEIGHT = 1
const CODE_HOSTING_NAMESPACE = /^(?:io|com)\.(?:github|gitlab|bitbucket)\./i
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/
const NON_PUBLIC_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'lan',
  'home',
  'test',
  'example',
  'invalid',
  'onion',
]
const COMBINING_MARKS = /\p{M}+/gu
const TITLE_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' })
const WORD_SEPARATORS = /[^\p{L}\p{N}]+/u

export type DirectoryExclusionReason
  = | 'no-title'
    | 'short-description'
    | 'not-https'
    | 'not-public'
    | 'duplicate'

export interface DirectorySourceRow {
  id: string
  name: string
  title: string | null
  description: string
  remoteUrl: string
  headerNames: string[]
  updatedAt: number
}

export interface DirectoryEntry {
  id: string
  name: string
  title: string
  hasRegistryTitle: boolean
  description: string
  remoteUrl: string
  host: string
  headerNames: string[]
  publisher: string | null
  isOfficial: boolean
  category: ConnectorCategoryId
  curatedRank: number | null
  presetId: string | null
  updatedAt: number
}

export interface DirectorySearchKeys {
  titleWords: string[]
  titleCompact: string
  nameWords: string[]
  nameCompact: string
  descriptionWords: string[]
}

export interface DirectoryIndex {
  entries: DirectoryEntry[]
  keys: DirectorySearchKeys[] | null
  byId: Map<string, DirectoryEntry>
  excluded: Partial<Record<DirectoryExclusionReason, number>>
  sourceRows: number
  sortedLists?: Map<string, DirectoryEntry[]>
}

/**
 * Lower-case text without accents (NFKD with the combining marks removed),
 * so "Vérif" and "verif" compare equal.
 */
export function normalizeDirectoryText(value: string): string {
  return value.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase()
}

export function tokenizeDirectoryText(value: string): string[] {
  return normalizeDirectoryText(value)
    .split(WORD_SEPARATORS)
    .filter(word => word.length > 0)
}

/**
 * The text with every space, hyphen and other separator removed, so a
 * missing or extra space ("hugging face", "huggingface", "Hugging-Face")
 * still matches.
 */
export function compactDirectoryText(value: string): string {
  return tokenizeDirectoryText(value).join('')
}

function lastNameSegment(name: string): string {
  return name.split('/').at(-1) || name
}

function namespaceDomain(name: string): string | null {
  const namespace = name.split('/')[0] ?? ''
  const labels = namespace.split('.').filter(Boolean)

  return labels.length >= 2 ? labels.reverse().join('.').toLowerCase() : null
}

function hostOf(remoteUrl: string): string {
  try {
    return new URL(remoteUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isWithinDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * True when the server runs on the domain its registry namespace names: the
 * host equals the reversed namespace or is a subdomain of it
 * (`com.notion` and `mcp.notion.com`). The registry accepts a domain
 * namespace only from a publisher who proved they control that domain, so
 * this says the publisher and the server's host are the same party. It is
 * not a security review. Code-hosting namespaces (`io.github.<user>`) are
 * verified by an account, not a domain, and never count.
 */
export function isOfficialRegistryEntry(
  name: string,
  remoteUrl: string,
): boolean {
  if (CODE_HOSTING_NAMESPACE.test(name)) {
    return false
  }

  const domain = namespaceDomain(name)
  const host = hostOf(remoteUrl)

  return !!domain && !!host && isWithinDomain(host, domain)
}

/**
 * True for an https address on a public DNS name: no IP literal, no
 * single-label or reserved name (`localhost`, `.local`, `.internal`, ...) and
 * no short-lived tunnel host (`trycloudflare.com`, `ngrok`, ...).
 */
export function isPublicDirectoryUrl(remoteUrl: string): boolean {
  let url: URL

  try {
    url = new URL(remoteUrl)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()
  const labels = host.split('.')
  const topLevel = labels.at(-1) ?? ''

  if (
    labels.length < 2
    || host.startsWith('[')
    || IPV4_HOST.test(host)
    || NON_PUBLIC_SUFFIXES.includes(topLevel)
  ) {
    return false
  }

  return !EPHEMERAL_TUNNEL_SUFFIXES.some((suffix) => {
    return isWithinDomain(host, suffix)
  })
}

interface CompiledTaxonomy {
  wordCategories: Map<string, number[]>
  phrases: Array<{ phrase: string, categoryIndex: number }>
}

let compiledTaxonomy: CompiledTaxonomy | null = null

function compileTaxonomy(): CompiledTaxonomy {
  if (compiledTaxonomy) {
    return compiledTaxonomy
  }

  const wordCategories = new Map<string, number[]>()
  const phrases: CompiledTaxonomy['phrases'] = []

  CONNECTOR_CATEGORIES.forEach((category, categoryIndex) => {
    for (const keyword of category.keywords as readonly string[]) {
      if (keyword.includes(' ')) {
        phrases.push({ phrase: ` ${keyword} `, categoryIndex })

        continue
      }

      const categories = wordCategories.get(keyword) ?? []

      categories.push(categoryIndex)
      wordCategories.set(keyword, categories)
    }
  })

  compiledTaxonomy = { wordCategories, phrases }

  return compiledTaxonomy
}

function addKeywordScores(
  scores: number[],
  words: readonly string[],
  weight: number,
  taxonomy: CompiledTaxonomy,
) {
  const padded = ` ${words.join(' ')} `

  for (const word of new Set(words)) {
    for (const categoryIndex of taxonomy.wordCategories.get(word) ?? []) {
      scores[categoryIndex] = (scores[categoryIndex] ?? 0) + weight
    }
  }

  for (const { phrase, categoryIndex } of taxonomy.phrases) {
    if (padded.includes(phrase)) {
      scores[categoryIndex] = (scores[categoryIndex] ?? 0) + weight
    }
  }
}

/**
 * The category of one entry from the keyword taxonomy in
 * `config/connectors-directory.ts`: a keyword found in the title or the
 * registry name scores three, one in the description scores one, the best
 * score wins, a tie keeps the earlier category, and no hit is Other.
 */
export function categorizeDirectoryEntry(input: {
  title: string | null
  name: string
  description: string
}): ConnectorCategoryId {
  const taxonomy = compileTaxonomy()
  const scores: number[] = []
  let best: ConnectorCategoryId = OTHER_CONNECTOR_CATEGORY_ID
  let bestScore = 0

  addKeywordScores(scores, [
    ...tokenizeDirectoryText(input.title ?? ''),
    ...tokenizeDirectoryText(lastNameSegment(input.name)),
  ], TITLE_WEIGHT, taxonomy)
  addKeywordScores(
    scores,
    tokenizeDirectoryText(input.description),
    DESCRIPTION_WEIGHT,
    taxonomy,
  )

  CONNECTOR_CATEGORIES.forEach((category, categoryIndex) => {
    const score = scores[categoryIndex] ?? 0

    if (score > bestScore) {
      best = category.id
      bestScore = score
    }
  })

  return best
}

/**
 * Why a registry row is left out of the directory, or null when it stays:
 * no title, a description under 20 characters, a remote that is not https
 * or not on a public name. A curated entry brings its own title and may
 * bring a description, so only the address rules apply to it.
 */
export function findDirectoryExclusion(
  row: Pick<DirectorySourceRow, 'title' | 'description' | 'remoteUrl'>,
  curated?: Pick<CuratedConnector, 'title' | 'description'>,
): DirectoryExclusionReason | null {
  if (!row.remoteUrl.toLowerCase().startsWith('https://')) {
    return 'not-https'
  }

  if (!isPublicDirectoryUrl(row.remoteUrl)) {
    return 'not-public'
  }

  if (curated) {
    return null
  }

  if (!row.title?.trim()) {
    return 'no-title'
  }

  return row.description.trim().length < DIRECTORY_MIN_DESCRIPTION_LENGTH
    ? 'short-description'
    : null
}

/**
 * The key two remotes are the same server by: lower-case host and port, the
 * path without a trailing slash, and the query string.
 */
export function directoryUrlKey(remoteUrl: string): string {
  try {
    const url = new URL(remoteUrl)
    const path = url.pathname.replace(/\/+$/, '')

    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`
  } catch {
    return remoteUrl
  }
}

function preferEntry(left: DirectoryEntry, right: DirectoryEntry): boolean {
  const leftCurated = left.curatedRank !== null
  const rightCurated = right.curatedRank !== null

  if (leftCurated !== rightCurated) {
    return leftCurated
  }

  if (left.isOfficial !== right.isOfficial) {
    return left.isOfficial
  }

  if (left.hasRegistryTitle !== right.hasRegistryTitle) {
    return left.hasRegistryTitle
  }

  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt
  }

  return left.id < right.id
}

function toEntry(
  row: DirectorySourceRow,
  curated: CuratedConnector | undefined,
  curatedRank: number | null,
): DirectoryEntry {
  const registryTitle = row.title?.trim() || null
  const title = curated?.title ?? registryTitle ?? lastNameSegment(row.name)
  const description = curated?.description ?? row.description

  return {
    id: row.id,
    name: row.name,
    title,
    hasRegistryTitle: !!registryTitle,
    description,
    remoteUrl: row.remoteUrl,
    host: hostOf(row.remoteUrl),
    headerNames: row.headerNames,
    publisher: deriveConnectorPublisher(row.name),
    isOfficial: isOfficialRegistryEntry(row.name, row.remoteUrl),
    category: categorizeDirectoryEntry({
      title,
      name: row.name,
      description,
    }),
    curatedRank,
    presetId: findConnectorPresetByUrl(row.remoteUrl)?.id ?? null,
    updatedAt: row.updatedAt,
  }
}

function toPresetEntry(
  preset: ConnectorPreset,
  curated: CuratedConnector,
  curatedRank: number,
): DirectoryEntry {
  const description = curated.description ?? preset.notice ?? ''

  return {
    id: `${DIRECTORY_PRESET_ID_PREFIX}${preset.id}`,
    name: `preset/${preset.id}`,
    title: curated.title,
    hasRegistryTitle: false,
    description,
    remoteUrl: preset.url,
    host: hostOf(preset.url),
    headerNames: preset.auth.includes('oauth') || !preset.headerName
      ? []
      : [preset.headerName],
    publisher: null,
    isOfficial: false,
    category: categorizeDirectoryEntry({
      title: curated.title,
      name: preset.id,
      description,
    }),
    curatedRank,
    presetId: preset.id,
    updatedAt: 0,
  }
}

/**
 * The lookup words of one entry: title words, the registry name and host
 * labels, and the description words, all normalized.
 */
export function buildDirectorySearchKeys(
  entry: DirectoryEntry,
): DirectorySearchKeys {
  const titleWords = tokenizeDirectoryText(entry.title)
  const nameWords = Array.from(new Set([
    ...tokenizeDirectoryText(entry.name),
    ...tokenizeDirectoryText(entry.host),
    ...tokenizeDirectoryText(entry.publisher ?? ''),
  ]))

  return {
    titleWords,
    titleCompact: titleWords.join(''),
    nameWords,
    nameCompact: compactDirectoryText(
      `${lastNameSegment(entry.name)} ${entry.host}`,
    ),
    descriptionWords: tokenizeDirectoryText(entry.description),
  }
}

/**
 * The search keys of every entry, built on the first search and kept on the
 * index, so browsing never pays for them.
 */
export function getDirectorySearchKeys(
  index: DirectoryIndex,
): DirectorySearchKeys[] {
  index.keys ??= index.entries.map(buildDirectorySearchKeys)

  return index.keys
}

/**
 * Adds the id lookup to a list of entries, for an index read back from its
 * cached copy. Search keys are built later, on the first search.
 */
export function indexDirectoryEntries(
  entries: DirectoryEntry[],
  extra: Pick<DirectoryIndex, 'excluded' | 'sourceRows'> = {
    excluded: {},
    sourceRows: entries.length,
  },
): DirectoryIndex {
  return {
    entries,
    keys: null,
    byId: new Map(entries.map(entry => [entry.id, entry])),
    ...extra,
  }
}

/**
 * The directory from the registry mirror: the quality filter, one entry per
 * remote address (the curated, official, titled, then newest row wins), the
 * curated titles, derived categories and official flags, plus a card for
 * every curated preset that the registry does not list.
 */
export function buildDirectoryIndex(
  rows: readonly DirectorySourceRow[],
): DirectoryIndex {
  const curatedByName = new Map<string, [CuratedConnector, number]>()
  const excluded: Partial<Record<DirectoryExclusionReason, number>> = {}
  const byUrl = new Map<string, DirectoryEntry>()

  CURATED_CONNECTORS.forEach((curated: CuratedConnector, rank) => {
    if (curated.registryName) {
      curatedByName.set(curated.registryName, [curated, rank])
    }
  })

  function exclude(reason: DirectoryExclusionReason) {
    excluded[reason] = (excluded[reason] ?? 0) + 1
  }

  for (const row of rows) {
    const [curated, rank] = curatedByName.get(row.name) ?? [undefined, null]
    const reason = findDirectoryExclusion(row, curated)

    if (reason) {
      exclude(reason)

      continue
    }

    const entry = toEntry(row, curated, rank)
    const key = directoryUrlKey(entry.remoteUrl)
    const current = byUrl.get(key)

    if (current) {
      exclude('duplicate')
    }

    if (!current || preferEntry(entry, current)) {
      byUrl.set(key, entry)
    }
  }

  const entries = [...byUrl.values()]
  const presentPresetIds = new Set(entries
    .map(entry => entry.presetId)
    .filter((presetId): presetId is string => !!presetId))

  CURATED_CONNECTORS.forEach((curated: CuratedConnector, rank) => {
    const preset = curated.presetId
      ? CONNECTOR_PRESETS.find(item => item.id === curated.presetId)
      : undefined

    if (preset && !presentPresetIds.has(preset.id)) {
      entries.push(toPresetEntry(preset, curated, rank))
    }
  })

  return indexDirectoryEntries(entries, {
    excluded,
    sourceRows: rows.length,
  })
}

export interface PreparedDirectoryQuery {
  words: string[]
  compact: string
}

export function prepareDirectoryQuery(query: string): PreparedDirectoryQuery {
  const words = tokenizeDirectoryText(query)

  return { words, compact: words.join('') }
}

function everyWordPrefixes(
  queryWords: readonly string[],
  words: readonly string[],
): boolean {
  return queryWords.every((queryWord) => {
    return words.some(word => word.startsWith(queryWord))
  })
}

/**
 * The rank of one entry for a query, lower is better, or null when it does
 * not match: 0 the whole title (spaces and hyphens ignored), 1 a title
 * prefix, 2 every query word starts a title word or the title contains the
 * query, 3 every word starts a word of the title, the registry name, the
 * publisher or the host (or they contain the query), 4 every word starts a
 * word anywhere, the description included. Matching ignores case, accents
 * and separators; "contains" needs at least three letters.
 */
export function rankDirectoryEntry(
  keys: DirectorySearchKeys,
  query: PreparedDirectoryQuery,
): number | null {
  if (!query.compact) {
    return null
  }

  if (keys.titleCompact === query.compact) {
    return 0
  }

  if (keys.titleCompact.startsWith(query.compact)) {
    return 1
  }

  const isInfixAllowed = query.compact.length >= DIRECTORY_MIN_INFIX_LENGTH

  if (
    everyWordPrefixes(query.words, keys.titleWords)
    || (isInfixAllowed && keys.titleCompact.includes(query.compact))
  ) {
    return 2
  }

  const nameWords = [...keys.titleWords, ...keys.nameWords]

  if (
    everyWordPrefixes(query.words, nameWords)
    || (isInfixAllowed && keys.nameCompact.includes(query.compact))
  ) {
    return 3
  }

  return everyWordPrefixes(query.words, [
    ...nameWords,
    ...keys.descriptionWords,
  ])
    ? 4
    : null
}

function startsWithLetter(title: string): boolean {
  return /^\p{L}/u.test(title)
}

/**
 * The browse order: curated entries by their rank, then titles that start
 * with a letter before those that start with a digit or a symbol, then
 * alphabetical regardless of case.
 */
export function compareDirectoryEntries(
  left: DirectoryEntry,
  right: DirectoryEntry,
): number {
  const leftRank = left.curatedRank ?? Number.MAX_SAFE_INTEGER
  const rightRank = right.curatedRank ?? Number.MAX_SAFE_INTEGER

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  const leftLetter = startsWithLetter(left.title)

  if (leftLetter !== startsWithLetter(right.title)) {
    return leftLetter ? -1 : 1
  }

  return TITLE_COLLATOR.compare(left.title, right.title)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

/**
 * Ranked search over the directory: matches by `rankDirectoryEntry`, then
 * the official entries first within a rank, then the browse order.
 */
export function searchDirectoryIndex(
  index: DirectoryIndex,
  query: string,
  filter: (entry: DirectoryEntry) => boolean = () => true,
): DirectoryEntry[] {
  const prepared = prepareDirectoryQuery(query)
  const keys = getDirectorySearchKeys(index)
  const matches: Array<{ entry: DirectoryEntry, rank: number }> = []

  index.entries.forEach((entry, position) => {
    if (!filter(entry)) {
      return
    }

    const rank = rankDirectoryEntry(keys[position]!, prepared)

    if (rank !== null) {
      matches.push({ entry, rank })
    }
  })

  return matches
    .sort((left, right) => {
      return left.rank - right.rank
        || Number(right.entry.isOfficial) - Number(left.entry.isOfficial)
        || compareDirectoryEntries(left.entry, right.entry)
    })
    .map(match => match.entry)
}

function memoizeList(
  index: DirectoryIndex,
  key: string,
  build: () => DirectoryEntry[],
): DirectoryEntry[] {
  index.sortedLists ??= new Map()

  const cached = index.sortedLists.get(key)

  if (cached) {
    return cached
  }

  const list = build()

  index.sortedLists.set(key, list)

  return list
}

/**
 * The curated entries in curation order. This and the other list helpers
 * sort once per index and keep the result on it, because sorting 12,000
 * titles with `localeCompare` on every request is the slow part.
 */
export function listTopDirectoryEntries(
  index: DirectoryIndex,
): DirectoryEntry[] {
  return memoizeList(index, 'top', () => {
    return index.entries
      .filter(entry => entry.curatedRank !== null)
      .sort(compareDirectoryEntries)
  })
}

/**
 * The newest entries by their registry update time, only those with a
 * registry title (a curated title does not count) and never a preset.
 */
export function listNewDirectoryEntries(
  index: DirectoryIndex,
): DirectoryEntry[] {
  return memoizeList(index, 'new', () => {
    return index.entries
      .filter(entry => entry.hasRegistryTitle && entry.updatedAt > 0)
      .sort((left, right) => {
        return right.updatedAt - left.updatedAt
          || (left.id < right.id ? -1 : 1)
      })
  })
}

export function listCategoryDirectoryEntries(
  index: DirectoryIndex,
  categoryId: ConnectorCategoryId | null,
): DirectoryEntry[] {
  return memoizeList(index, `category:${categoryId ?? '*'}`, () => {
    const all = memoizeList(index, 'category:*', () => {
      return [...index.entries].sort(compareDirectoryEntries)
    })

    return categoryId === null
      ? all
      : all.filter(entry => entry.category === categoryId)
  })
}

export function countDirectoryCategories(
  index: DirectoryIndex,
): Map<ConnectorCategoryId, number> {
  const counts = new Map<ConnectorCategoryId, number>()

  for (const entry of index.entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  }

  return counts
}

export function isDirectoryCategoryId(
  value: unknown,
): value is ConnectorCategoryId {
  return CONNECTOR_CATEGORIES.some(category => category.id === value)
}
