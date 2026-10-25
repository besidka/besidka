import type {
  KnowledgePackHeader,
  KnowledgePackLine,
} from '#shared/types/project-knowledge.d'
import { and, asc, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  knowledgePackHeaderSchema,
  knowledgePackLineSchema,
  knowledgeTextByteLength,
} from '#shared/utils/project-knowledge-schemas'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { resolveServerLogger } from '~~/server/utils/files/logger'
import { chunkKnowledgeText } from '~~/server/utils/knowledge/chunk'
import {
  getKnowledgeProjectState,
} from '~~/server/utils/knowledge/items'
import type { KnowledgeProjectState } from '~~/server/utils/knowledge/items'
import { acquireKnowledgePackLease } from '~~/server/utils/knowledge/pack-lease'
import {
  knowledgePackKey,
  knowledgeProjectPrefix,
} from '~~/server/utils/knowledge/storage-keys'
import {
  deleteKnowledgeItemTexts,
  getKnowledgeItemText,
} from '~~/server/utils/knowledge/text-store'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'

const MEBIBYTE = 1024 * 1024
const MAX_DECOMPRESSED_PACK_BYTES
  = 4 * KNOWLEDGE_LIMITS.maxProjectTextBytes + 2 * MEBIBYTE
const MAX_COMPRESSED_PACK_BYTES
  = 2 * KNOWLEDGE_LIMITS.maxProjectTextBytes + MEBIBYTE
const MAX_PACK_LINES = 20_000
const MAX_CHUNK_LINE_CHARS = 64 * 1024
const MAX_HEADER_LINE_CHARS = 256 * 1024
const MAX_IDS_PER_STATEMENT = 90
const R2_LIST_PAGE_SIZE = 1000
const R2_DELETE_BATCH_SIZE = 1000
const PACKS_TO_KEEP = 2
const PACK_KEY_PATTERN = /\/pack\/v(\d+)\.(?:jsonl|index\.json)\.gz$/

interface KnowledgePack {
  header: KnowledgePackHeader
  lines: KnowledgePackLine[]
}

interface PackCursor {
  itemIndex: number
  ordinal: number
}

function packLog(
  logger: LoggerLike,
  fields: Record<string, unknown>,
): void {
  logger.set({ attributes: { knowledgePack: fields } })
}

function nextCursorWithChunks(
  header: KnowledgePackHeader,
  itemIndex: number,
): PackCursor {
  let index = itemIndex

  while (index < header.items.length && header.items[index]!.chunks === 0) {
    index++
  }

  return { itemIndex: index, ordinal: 0 }
}

function parseHeaderLine(
  line: string,
  expectedVersion: number,
): KnowledgePackHeader | null {
  if (line.length > MAX_HEADER_LINE_CHARS) {
    return null
  }

  const parsed = knowledgePackHeaderSchema.safeParse(JSON.parse(line))

  if (!parsed.success || parsed.data.version !== expectedVersion) {
    return null
  }

  const itemIds = new Set(parsed.data.items.map((item) => {
    return item.itemId
  }))
  const totalChunks = parsed.data.items.reduce((sum, item) => {
    return sum + item.chunks
  }, 0)

  if (
    parsed.data.items.length > KNOWLEDGE_LIMITS.maxItemsPerProject
    || itemIds.size !== parsed.data.items.length
    || totalChunks > MAX_PACK_LINES
  ) {
    return null
  }

  return parsed.data
}

/**
 * Consumes a decompressed pack stream line by line. Every limit is checked
 * while reading, so a hostile object is abandoned as soon as it crosses a
 * cap instead of after being inflated in full. Returns null for anything
 * that is not a well-formed pack of the expected version.
 */
async function parsePackStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  expectedVersion: number,
): Promise<KnowledgePack | null> {
  const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const lines: KnowledgePackLine[] = []
  let header: KnowledgePackHeader | null = null
  let cursor: PackCursor = { itemIndex: 0, ordinal: 0 }
  let decompressedBytes = 0
  let buffer = ''

  function acceptLine(line: string): boolean {
    if (line === '') {
      return false
    }

    if (!header) {
      header = parseHeaderLine(line, expectedVersion)
      cursor = header ? nextCursorWithChunks(header, 0) : cursor

      return header !== null
    }

    const expectedItem = header.items[cursor.itemIndex]

    if (
      !expectedItem
      || line.length > MAX_CHUNK_LINE_CHARS
      || lines.length >= MAX_PACK_LINES
    ) {
      return false
    }

    const parsed = knowledgePackLineSchema.safeParse(JSON.parse(line))

    if (
      !parsed.success
      || parsed.data.itemId !== expectedItem.itemId
      || parsed.data.ordinal !== cursor.ordinal
    ) {
      return false
    }

    lines.push(parsed.data)

    cursor = cursor.ordinal + 1 >= expectedItem.chunks
      ? nextCursorWithChunks(header, cursor.itemIndex + 1)
      : { itemIndex: cursor.itemIndex, ordinal: cursor.ordinal + 1 }

    return true
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      decompressedBytes += value.byteLength

      if (decompressedBytes > MAX_DECOMPRESSED_PACK_BYTES) {
        await cancelQuietly(reader)

        return null
      }

      buffer += decoder.decode(value, { stream: true })

      const completeLines = buffer.split('\n')

      buffer = completeLines.pop()!

      if (buffer.length > MAX_HEADER_LINE_CHARS) {
        await cancelQuietly(reader)

        return null
      }

      for (const line of completeLines) {
        if (!acceptLine(line)) {
          await cancelQuietly(reader)

          return null
        }
      }
    }

    buffer += decoder.decode()

    if (buffer !== '' && !acceptLine(buffer)) {
      return null
    }
  } catch (_exception) {
    await cancelQuietly(reader)

    return null
  }

  const finishedHeader = header as KnowledgePackHeader | null

  if (!finishedHeader || cursor.itemIndex < finishedHeader.items.length) {
    return null
  }

  return { header: finishedHeader, lines }
}

async function cancelQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel()
  } catch (_exception) {
    return
  }
}

async function gzipText(text: string): Promise<ArrayBuffer> {
  const compressed = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  return await new Response(compressed).arrayBuffer()
}

/**
 * Reads and validates one pack version: gunzip with a hard cap on the
 * decompressed size (a gzip bomb is abandoned mid-stream), a cap on lines
 * and on each line, every line checked with the K0 zod schemas, the header
 * version equal to the requested one, and the chunk lines exactly matching
 * the header (same items in order, ordinals from 0, same counts). A
 * missing, corrupt, oversize or wrong-version pack is `null`, never a throw.
 */
export async function readKnowledgePack(input: {
  userId: number
  projectId: number
  version: number
}): Promise<{
  header: KnowledgePackHeader
  lines: KnowledgePackLine[]
} | null> {
  try {
    const key = knowledgePackKey(input.userId, input.projectId, input.version)
    const storage = useFileStorage()
    const object = await storage.get(key)

    if (!object) {
      return null
    }

    if (object.size > MAX_COMPRESSED_PACK_BYTES) {
      await object.body.cancel()

      return null
    }

    return await parsePackStream(object.body, input.version)
  } catch (_exception) {
    return null
  }
}

async function listPackVersions(
  userId: number,
  projectId: number,
): Promise<Map<number, string[]>> {
  const storage = useFileStorage()
  const prefix = `${knowledgeProjectPrefix(userId, projectId)}pack/`
  const keysByVersion = new Map<number, string[]>()
  let cursor: string | undefined

  do {
    const page = await storage.list({
      prefix,
      cursor,
      limit: R2_LIST_PAGE_SIZE,
    })

    for (const object of page.objects) {
      const match = PACK_KEY_PATTERN.exec(object.key)

      if (match) {
        const version = Number(match[1])
        const keys = keysByVersion.get(version) ?? []

        keys.push(object.key)
        keysByVersion.set(version, keys)
      }
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return keysByVersion
}

function needsBuild(state: KnowledgeProjectState): boolean {
  return state.version > 0
    && (state.packVersion === null || state.packVersion < state.version)
}

async function requireProjectState(input: {
  userId: number
  projectId: number
}): Promise<KnowledgeProjectState> {
  const state = await getKnowledgeProjectState(input)

  if (!state) {
    throw createError({
      message: 'Project not found',
      status: 404,
      why: 'The project does not exist or belongs to another user',
      fix: 'Check the project id',
    })
  }

  return state
}

async function readPreviousPack(
  userId: number,
  projectId: number,
  previousVersion: number | null,
  logger: LoggerLike,
): Promise<KnowledgePack | null> {
  if (previousVersion === null) {
    return null
  }

  const previous = await readKnowledgePack({
    userId,
    projectId,
    version: previousVersion,
  })

  if (!previous) {
    packLog(logger, { operation: 'previous-unreadable', previousVersion })
  }

  return previous
}

async function selectPackItems(userId: number, projectId: number) {
  return await useDb()
    .select({
      publicId: schema.projectKnowledgeItems.id,
      internalId: sql<number>`${schema.projectKnowledgeItems.id}`,
      title: schema.projectKnowledgeItems.title,
      relativePath: schema.projectKnowledgeItems.relativePath,
      updatedAt: schema.projectKnowledgeItems.updatedAt,
      extractStatus: schema.projectKnowledgeItems.extractStatus,
    })
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.userId, userId),
      eq(schema.projectKnowledgeItems.projectId, projectId),
    ))
    .orderBy(
      asc(schema.projectKnowledgeItems.createdAt),
      asc(schema.projectKnowledgeItems.id),
    )
}

async function deleteStalePacks(input: {
  keysByVersion: Map<number, string[]>
  builtVersion: number
  currentPackVersion: number
  logger: LoggerLike
}): Promise<void> {
  const versions = new Set(input.keysByVersion.keys())

  versions.add(input.builtVersion)

  const newestVersions = new Set(
    [...versions]
      .sort((first, second) => {
        return second - first
      })
      .slice(0, PACKS_TO_KEEP),
  )
  const staleKeys = [...input.keysByVersion.entries()]
    .filter(([version]) => {
      return !newestVersions.has(version)
        && version < input.currentPackVersion
    })
    .flatMap(([, keys]) => {
      return keys
    })

  if (staleKeys.length === 0) {
    return
  }

  const storage = useFileStorage()

  for (let start = 0; start < staleKeys.length; start += R2_DELETE_BATCH_SIZE) {
    await storage.delete(staleKeys.slice(start, start + R2_DELETE_BATCH_SIZE))
  }

  packLog(input.logger, {
    operation: 'retention',
    deletedKeys: staleKeys.length,
  })
}

async function buildLeasedPack(
  input: { userId: number, projectId: number },
  logger: LoggerLike,
): Promise<{ packVersion: number, built: boolean }> {
  const { userId, projectId } = input
  const state = await requireProjectState(input)

  if (!needsBuild(state)) {
    return { packVersion: state.packVersion ?? 0, built: false }
  }

  const targetVersion = state.version
  let keysByVersion = new Map<number, string[]>()
  let isListingKnown = true

  try {
    keysByVersion = await listPackVersions(userId, projectId)
  } catch (exception) {
    isListingKnown = false
    packLog(logger, { operation: 'list', error: exceptionMessage(exception) })
  }

  const listedPreviousVersion = [...keysByVersion.keys()]
    .filter((version) => {
      return version < targetVersion
    })
    .sort((first, second) => {
      return second - first
    })[0] ?? null
  const previousVersion = isListingKnown
    ? listedPreviousVersion
    : state.packVersion
  const previous = await readPreviousPack(
    userId,
    projectId,
    previousVersion,
    logger,
  )
  const previousEntries = new Map(
    (previous?.header.items ?? []).map((entry) => {
      return [entry.itemId, entry] as const
    }),
  )
  const previousLinesByItem = new Map<string, KnowledgePackLine[]>()

  for (const line of previous?.lines ?? []) {
    const itemLines = previousLinesByItem.get(line.itemId) ?? []

    itemLines.push(line)
    previousLinesByItem.set(line.itemId, itemLines)
  }

  const rows = await selectPackItems(userId, projectId)
  const headerItems: KnowledgePackHeader['items'] = []
  const packLines: KnowledgePackLine[] = []
  let reusedItems = 0
  let chunkedItems = 0
  let missingTextItems = 0

  for (const row of rows) {
    if (row.extractStatus !== 'ready') {
      continue
    }

    const updatedAt = row.updatedAt.toISOString()
    const previousEntry = previousEntries.get(row.publicId)
    const previousLines = previousLinesByItem.get(row.publicId) ?? []

    if (
      previousEntry
      && previousEntry.updatedAt === updatedAt
      && previousEntry.chunks === previousLines.length
    ) {
      headerItems.push(previousEntry)
      packLines.push(...previousLines)
      reusedItems++

      continue
    }

    const text = await getKnowledgeItemText({
      userId,
      projectId,
      itemId: row.internalId,
    })

    if (text === null) {
      missingTextItems++

      continue
    }

    const chunks = chunkKnowledgeText({
      itemId: row.publicId,
      title: row.title,
      relativePath: row.relativePath,
      text,
    })

    headerItems.push({
      itemId: row.publicId,
      updatedAt,
      chunks: chunks.length,
    })
    packLines.push(...chunks)
    chunkedItems++
  }

  const header: KnowledgePackHeader = {
    type: 'header',
    version: targetVersion,
    builtAt: new Date().toISOString(),
    items: headerItems,
  }
  const ndjson = [header, ...packLines]
    .map((line) => {
      return JSON.stringify(line)
    })
    .join('\n')
    .concat('\n')

  if (
    packLines.length > MAX_PACK_LINES
    || knowledgeTextByteLength(ndjson) > MAX_DECOMPRESSED_PACK_BYTES
  ) {
    throw createError({
      message: 'Project knowledge is too large to index',
      status: 422,
      why: `The pack would have ${packLines.length} chunks and exceed the cap`,
      fix: 'Remove some knowledge items',
    })
  }

  const storage = useFileStorage()

  await storage.put(
    knowledgePackKey(userId, projectId, targetVersion),
    await gzipText(ndjson),
    { httpMetadata: { contentType: 'application/gzip' } },
  )

  await useDb()
    .update(schema.projects)
    .set({ knowledgePackVersion: targetVersion })
    .where(and(
      sql`${schema.projects.id} = ${projectId}`,
      eq(schema.projects.userId, userId),
      sql`(${schema.projects.knowledgePackVersion} is null
        or ${schema.projects.knowledgePackVersion} < ${targetVersion})`,
    ))

  const latestState = await getKnowledgeProjectState(input)
  const currentPackVersion = latestState?.packVersion ?? targetVersion

  packLog(logger, {
    operation: 'built',
    version: targetVersion,
    previousVersion,
    items: headerItems.length,
    chunks: packLines.length,
    reusedItems,
    chunkedItems,
    missingTextItems,
  })

  try {
    await deleteStalePacks({
      keysByVersion,
      builtVersion: targetVersion,
      currentPackVersion,
      logger,
    })
  } catch (exception) {
    packLog(logger, {
      operation: 'retention',
      error: exceptionMessage(exception),
    })
  }

  return {
    packVersion: Math.max(currentPackVersion, targetVersion),
    built: true,
  }
}

/**
 * Builds the pack for the project's current `knowledge_version` under the
 * `knowledge-pack-build:<projectId>` KV lease. Incremental: the newest
 * existing earlier pack (found by listing the `pack/` prefix, since versions
 * can skip) is read, its chunks are kept for items whose row still exists
 * with the same `updatedAt`, and only new or changed items have their text
 * read (sequentially) and chunked. A metadata-only edit also bumps
 * `updatedAt`, so that item is re-chunked although its text did not change;
 * the cost is bounded by the project text cap. An item whose row exists but
 * whose text object is not there yet is left out and picked up by a later
 * build. The new object is written under a versioned key, then
 * `knowledge_pack_version` advances only while it is null or lower, and
 * every existing pack except the two newest is deleted in batches.
 * `built: false` means there was nothing to do or another build holds the
 * lease; `packVersion` is then the current pack version, or 0 when the
 * project has never had a pack.
 */
export async function buildKnowledgePack(input: {
  userId: number
  projectId: number
  logger?: LoggerLike
}): Promise<{ packVersion: number, built: boolean }> {
  const logger = resolveServerLogger(input.logger)
  const state = await requireProjectState(input)

  if (!needsBuild(state)) {
    return { packVersion: state.packVersion ?? 0, built: false }
  }

  const lease = await acquireKnowledgePackLease(input.projectId, logger)

  if (!lease) {
    packLog(logger, { operation: 'leased' })

    return { packVersion: state.packVersion ?? 0, built: false }
  }

  try {
    return await buildLeasedPack(input, logger)
  } finally {
    await lease.release()
  }
}

function groupIds(ids: number[]): number[][] {
  const groups: number[][] = []

  for (let start = 0; start < ids.length; start += MAX_IDS_PER_STATEMENT) {
    groups.push(ids.slice(start, start + MAX_IDS_PER_STATEMENT))
  }

  return groups
}

function idListSql(ids: number[]) {
  return sql.join(
    ids.map((id) => {
      return sql`${id}`
    }),
    sql`, `,
  )
}

async function removeScopedItems(input: {
  userId: number
  projectId: number
  itemIds: number[]
}): Promise<number> {
  const db = useDb()
  const candidateIds = [...new Set(input.itemIds)].filter((id) => {
    return Number.isSafeInteger(id) && id > 0
  })
  let removedCount = 0

  for (const group of groupIds(candidateIds)) {
    const scope = and(
      sql`${schema.projectKnowledgeItems.id} in (${idListSql(group)})`,
      eq(schema.projectKnowledgeItems.projectId, input.projectId),
      eq(schema.projectKnowledgeItems.userId, input.userId),
    )
    const ownedRows = await db
      .select({ internalId: sql<number>`${schema.projectKnowledgeItems.id}` })
      .from(schema.projectKnowledgeItems)
      .where(scope)
    const ownedIds = ownedRows.map((row) => {
      return row.internalId
    })

    if (ownedIds.length === 0) {
      continue
    }

    await deleteKnowledgeItemTexts({
      userId: input.userId,
      projectId: input.projectId,
      itemIds: ownedIds,
    })
    await db.delete(schema.projectKnowledgeItems).where(scope)

    removedCount += ownedIds.length
  }

  return removedCount
}

/**
 * Commits a knowledge change: removes the listed items (only rows of this
 * project and user: the text objects first, then the rows), bumps
 * `knowledge_version` once and builds the next pack. The bump happens even
 * when a removal fails (the failure is rethrown afterwards), so a stale
 * pack always has a pending rebuild. A failed or leased build never loses
 * the bump: the result carries the previous `packVersion` (null when the
 * project never had one), the failure is logged, and the next send or panel
 * load rebuilds lazily. Throws a 404 only when the project is not the
 * user's.
 */
export async function commitKnowledgeChange(input: {
  userId: number
  projectId: number
  removeItemIds?: number[]
  logger?: LoggerLike
}): Promise<{ version: number, packVersion: number | null }> {
  const logger = resolveServerLogger(input.logger)
  const { userId, projectId } = input

  await requireProjectState({ userId, projectId })

  let removalFailure: unknown = null

  try {
    const removedCount = await removeScopedItems({
      userId,
      projectId,
      itemIds: input.removeItemIds ?? [],
    })

    if (removedCount > 0) {
      packLog(logger, { operation: 'removed', removedCount })
    }
  } catch (exception) {
    removalFailure = exception
    packLog(logger, {
      operation: 'remove',
      error: exceptionMessage(exception),
    })
  }

  await bumpKnowledgeVersion([projectId])

  if (removalFailure) {
    throw removalFailure
  }

  const bumpedState = await requireProjectState({ userId, projectId })

  try {
    const result = await buildKnowledgePack({ userId, projectId, logger })

    return {
      version: bumpedState.version,
      packVersion: result.built
        ? result.packVersion
        : bumpedState.packVersion,
    }
  } catch (exception) {
    packLog(logger, {
      operation: 'commit-build',
      error: exceptionMessage(exception),
    })

    return {
      version: bumpedState.version,
      packVersion: bumpedState.packVersion,
    }
  }
}

/**
 * Rebuilds the pack when `knowledge_pack_version` is behind
 * `knowledge_version`. Never throws: it is the lazy recovery path run from
 * `waitUntil`, so a failure is logged and left for the next call. A no-op
 * when the pack is fresh, and effectively a no-op while another build holds
 * the lease.
 */
export async function ensureKnowledgePackFresh(input: {
  userId: number
  projectId: number
  logger?: LoggerLike
}): Promise<void> {
  const logger = resolveServerLogger(input.logger)

  try {
    const state = await getKnowledgeProjectState(input)

    if (!state || !needsBuild(state)) {
      return
    }

    await buildKnowledgePack({
      userId: input.userId,
      projectId: input.projectId,
      logger,
    })
  } catch (exception) {
    try {
      packLog(logger, {
        operation: 'ensure',
        error: exceptionMessage(exception),
      })
    } catch (_loggingException) {
      return
    }
  }
}
