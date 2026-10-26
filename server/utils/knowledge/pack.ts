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
import {
  acquireKnowledgePackLease,
  clearKnowledgePackBackoff,
  isKnowledgePackBackedOff,
  isKnowledgePackRecentlyBuilt,
  recordKnowledgePackBuilt,
  recordKnowledgePackFailure,
} from '~~/server/utils/knowledge/pack-lease'
import {
  knowledgePackKey,
  knowledgeProjectPrefix,
} from '~~/server/utils/knowledge/storage-keys'
import {
  deleteKnowledgeItemTexts,
  readKnowledgeItemText,
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
const HEAL_MIN_ROW_AGE_MS = 60 * 60 * 1000
const MAX_MISMATCH_HEALS_PER_BUILD = 50
const PACK_KEY_PATTERN = /\/pack\/v(\d+)\.(?:jsonl|index\.json)\.gz$/

interface KnowledgePack {
  header: KnowledgePackHeader
  lines: KnowledgePackLine[]
}

interface PackCursor {
  itemIndex: number
  ordinal: number
}

type BuildOutcome = 'built' | 'fresh' | 'leased' | 'refused'

interface BuildResult {
  packVersion: number
  built: boolean
  outcome: BuildOutcome
}

/**
 * Writes under `attributes.knowledgePack.<section>`, one section per
 * operation, so evlog's deep merge never overwrites one operation's fields
 * with another's within a request.
 */
function packLog(
  logger: LoggerLike,
  section: string,
  fields: Record<string, unknown>,
): void {
  logger.set({ attributes: { knowledgePack: { [section]: fields } } })
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
    packLog(logger, 'previous', {
      operation: 'previous-unreadable',
      previousVersion,
    })
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
      textBytes: schema.projectKnowledgeItems.textBytes,
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
  preBuildPackVersion: number | null
  logger: LoggerLike
}): Promise<void> {
  const versions = new Set(input.keysByVersion.keys())

  versions.add(input.builtVersion)

  const newestFirst = [...versions].sort((first, second) => {
    return second - first
  })
  const protectedVersions = new Set(newestFirst.slice(0, PACKS_TO_KEEP))
  const newestBelowCurrent = newestFirst.find((version) => {
    return version < input.currentPackVersion
  })

  if (newestBelowCurrent !== undefined) {
    protectedVersions.add(newestBelowCurrent)
  }

  if (input.preBuildPackVersion !== null) {
    protectedVersions.add(input.preBuildPackVersion)
  }

  const staleKeys = [...input.keysByVersion.entries()]
    .filter(([version]) => {
      return !protectedVersions.has(version)
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

  packLog(input.logger, 'retention', {
    operation: 'retention',
    deletedKeys: staleKeys.length,
  })
}

async function selectReadyTotals(
  userId: number,
  projectId: number,
): Promise<{ count: number, textBytes: number }> {
  const rows = await useDb()
    .select({
      count: sql<number>`count(*)`,
      textBytes: sql<number>`coalesce(
        sum(${schema.projectKnowledgeItems.textBytes}), 0
      )`,
    })
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.userId, userId),
      eq(schema.projectKnowledgeItems.projectId, projectId),
      eq(schema.projectKnowledgeItems.extractStatus, 'ready'),
    ))

  return {
    count: Number(rows[0]?.count ?? 0),
    textBytes: Number(rows[0]?.textBytes ?? 0),
  }
}

async function healMissingTextRows(input: {
  userId: number
  projectId: number
  itemIds: number[]
  logger: LoggerLike
}): Promise<void> {
  if (input.itemIds.length === 0) {
    return
  }

  try {
    const db = useDb()

    for (const group of groupIds(input.itemIds)) {
      await db
        .update(schema.projectKnowledgeItems)
        .set({
          extractStatus: 'failed',
          extractError: 'text-missing',
          textBytes: 0,
        })
        .where(and(
          sql`${schema.projectKnowledgeItems.id} in (${idListSql(group)})`,
          eq(schema.projectKnowledgeItems.userId, input.userId),
          eq(schema.projectKnowledgeItems.projectId, input.projectId),
          eq(schema.projectKnowledgeItems.extractStatus, 'ready'),
        ))
    }

    packLog(input.logger, 'heal', {
      operation: 'text-missing',
      healedItems: input.itemIds.length,
    })
  } catch (exception) {
    packLog(input.logger, 'heal', {
      operation: 'text-missing',
      error: exceptionMessage(exception),
    })
  }
}

interface SizeMismatchRow {
  internalId: number
  updatedAt: Date
}

/**
 * Marks ready rows whose R2 object size disagrees with `text_bytes` as
 * `failed` with `text-mismatch`, so the list stops showing them as ready
 * while the pack leaves them out. Healing from R2 instead would trust an
 * object that may be the older half of a note edit (the row is updated
 * first, the object second), so the row is only surfaced, never rewritten
 * from storage: `text_bytes` stays as it was (the quota keeps counting it
 * until the user removes or repairs the item) and the character counts go to
 * 0 so the meter stops counting text that is not sent. Each update is
 * matched on the `updated_at` the build saw, so an edit that landed since is
 * left alone, and the caller passes only rows past the heal age gate.
 */
async function failSizeMismatchRows(input: {
  userId: number
  projectId: number
  rows: SizeMismatchRow[]
  logger: LoggerLike
}): Promise<void> {
  if (input.rows.length === 0) {
    return
  }

  let failedItems = 0

  try {
    const db = useDb()

    for (const row of input.rows.slice(0, MAX_MISMATCH_HEALS_PER_BUILD)) {
      const updated = await db
        .update(schema.projectKnowledgeItems)
        .set({
          extractStatus: 'failed',
          extractError: 'text-mismatch',
          latinChars: 0,
          cyrillicChars: 0,
          otherChars: 0,
        })
        .where(and(
          sql`${schema.projectKnowledgeItems.id} = ${row.internalId}`,
          eq(schema.projectKnowledgeItems.userId, input.userId),
          eq(schema.projectKnowledgeItems.projectId, input.projectId),
          eq(schema.projectKnowledgeItems.extractStatus, 'ready'),
          eq(schema.projectKnowledgeItems.updatedAt, row.updatedAt),
        ))
        .returning({ internalId: sql<number>`${schema.projectKnowledgeItems.id}` })

      failedItems += updated.length
    }

    packLog(input.logger, 'heal-mismatch', {
      operation: 'text-mismatch',
      failedItems,
    })
  } catch (exception) {
    packLog(input.logger, 'heal-mismatch', {
      operation: 'text-mismatch',
      failedItems,
      error: exceptionMessage(exception),
    })
  }
}

function refuseWrite(
  logger: LoggerLike,
  state: KnowledgeProjectState,
  counts: Record<string, number>,
): BuildResult {
  packLog(logger, 'build', {
    operation: 'refused',
    reason: 'pack-too-large',
    ...counts,
  })

  return {
    packVersion: state.packVersion ?? 0,
    built: false,
    outcome: 'refused',
  }
}

async function buildLeasedPack(
  input: { userId: number, projectId: number },
  logger: LoggerLike,
): Promise<BuildResult> {
  const { userId, projectId } = input
  const state = await requireProjectState(input)

  if (!needsBuild(state)) {
    return {
      packVersion: state.packVersion ?? 0,
      built: false,
      outcome: 'fresh',
    }
  }

  const readyTotals = await selectReadyTotals(userId, projectId)

  if (
    readyTotals.count > KNOWLEDGE_LIMITS.maxItemsPerProject
    || readyTotals.textBytes > KNOWLEDGE_LIMITS.maxProjectTextBytes
  ) {
    packLog(logger, 'build', {
      operation: 'refused',
      reason: 'over-limits',
      items: readyTotals.count,
      textBytes: readyTotals.textBytes,
    })

    return {
      packVersion: state.packVersion ?? 0,
      built: false,
      outcome: 'refused',
    }
  }

  const targetVersion = state.version
  let keysByVersion = new Map<number, string[]>()
  let isListingKnown = true

  try {
    keysByVersion = await listPackVersions(userId, projectId)
  } catch (exception) {
    isListingKnown = false
    packLog(logger, 'list', {
      operation: 'list',
      error: exceptionMessage(exception),
    })
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
  let sizeMismatchItems = 0
  const healCutoffMs = Date.now() - HEAL_MIN_ROW_AGE_MS
  const healItemIds: number[] = []
  const mismatchRows: SizeMismatchRow[] = []

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

    const stored = await readKnowledgeItemText({
      userId,
      projectId,
      itemId: row.internalId,
    })

    if (stored !== null && stored.bytes !== row.textBytes) {
      sizeMismatchItems++

      if (row.updatedAt.getTime() <= healCutoffMs) {
        mismatchRows.push({
          internalId: row.internalId,
          updatedAt: row.updatedAt,
        })
      }

      continue
    }

    const text = stored === null ? null : stored.text

    if (text === null) {
      missingTextItems++

      if (row.textBytes > 0 && row.updatedAt.getTime() <= healCutoffMs) {
        healItemIds.push(row.internalId)
      }

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

  await healMissingTextRows({ userId, projectId, itemIds: healItemIds, logger })
  await failSizeMismatchRows({ userId, projectId, rows: mismatchRows, logger })

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
  const serializedBytes = knowledgeTextByteLength(ndjson)

  if (
    headerItems.length > KNOWLEDGE_LIMITS.maxItemsPerProject
    || packLines.length > MAX_PACK_LINES
    || serializedBytes > MAX_DECOMPRESSED_PACK_BYTES
  ) {
    return refuseWrite(logger, state, {
      items: headerItems.length,
      chunks: packLines.length,
      serializedBytes,
    })
  }

  const compressed = await gzipText(ndjson)

  if (compressed.byteLength > MAX_COMPRESSED_PACK_BYTES) {
    return refuseWrite(logger, state, {
      items: headerItems.length,
      chunks: packLines.length,
      serializedBytes,
      compressedBytes: compressed.byteLength,
    })
  }

  const storage = useFileStorage()

  await storage.put(
    knowledgePackKey(userId, projectId, targetVersion),
    compressed,
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

  packLog(logger, 'build', {
    operation: 'built',
    version: targetVersion,
    previousVersion,
    items: headerItems.length,
    chunks: packLines.length,
    reusedItems,
    chunkedItems,
    missingTextItems,
    sizeMismatchItems,
  })

  try {
    await deleteStalePacks({
      keysByVersion,
      builtVersion: targetVersion,
      currentPackVersion,
      preBuildPackVersion: state.packVersion,
      logger,
    })
  } catch (exception) {
    packLog(logger, 'retention', {
      operation: 'retention',
      error: exceptionMessage(exception),
    })
  }

  return {
    packVersion: Math.max(currentPackVersion, targetVersion),
    built: true,
    outcome: 'built',
  }
}

async function runBuild(
  input: { userId: number, projectId: number },
  logger: LoggerLike,
): Promise<BuildResult> {
  const state = await requireProjectState(input)

  if (!needsBuild(state)) {
    return {
      packVersion: state.packVersion ?? 0,
      built: false,
      outcome: 'fresh',
    }
  }

  const lease = await acquireKnowledgePackLease(input.projectId, logger)

  if (!lease) {
    packLog(logger, 'build', { operation: 'leased' })

    return {
      packVersion: state.packVersion ?? 0,
      built: false,
      outcome: 'leased',
    }
  }

  try {
    return await buildLeasedPack(input, logger)
  } finally {
    await lease.release()
  }
}

/**
 * Runs a build and feeds the failed-build counter: a refused or thrown build
 * counts as a failure for the target version, a finished one clears the
 * counter. A thrown failure is recorded and rethrown.
 */
async function runTrackedBuild(
  input: { userId: number, projectId: number, version: number },
  logger: LoggerLike,
): Promise<BuildResult> {
  let result: BuildResult

  try {
    result = await runBuild(input, logger)
  } catch (exception) {
    await recordKnowledgePackFailure(input.projectId, input.version, logger)

    throw exception
  }

  if (result.outcome === 'refused') {
    await recordKnowledgePackFailure(input.projectId, input.version, logger)
  } else if (result.outcome === 'built') {
    await clearKnowledgePackBackoff(input.projectId, logger)
    await recordKnowledgePackBuilt(input.projectId, logger)
  }

  return result
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
 * `built: false` means there was nothing to do, another build holds the
 * lease, or the build was refused (the project is over its item or text
 * limits, or the pack would exceed the size caps the reader enforces; nothing
 * is written and the pointer does not move); `packVersion` is then the
 * current pack version, or 0 when the project has never had a pack. A `ready`
 * row with text bytes whose text object is missing and which has not been
 * touched for an hour is marked `failed` with `text-missing`, and so is one
 * whose text object has a different size than the row declares
 * (`text-mismatch`, never healed from R2); a younger row is left to the
 * edit that may still be writing its object.
 */
export async function buildKnowledgePack(input: {
  userId: number
  projectId: number
  logger?: LoggerLike
}): Promise<{ packVersion: number, built: boolean }> {
  const logger = resolveServerLogger(input.logger)
  const { packVersion, built } = await runBuild(input, logger)

  return { packVersion, built }
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
      packLog(logger, 'removal', { operation: 'removed', removedCount })
    }
  } catch (exception) {
    removalFailure = exception
    packLog(logger, 'removal', {
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
    const result = await runTrackedBuild(
      { userId, projectId, version: bumpedState.version },
      logger,
    )

    return {
      version: bumpedState.version,
      packVersion: result.built
        ? result.packVersion
        : bumpedState.packVersion,
    }
  } catch (exception) {
    packLog(logger, 'commit', {
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
 * the lease. After three consecutive failed or refused builds for the same
 * `knowledge_version` it stops scheduling rebuilds for ten minutes (a KV
 * counter; a new version resets it and a finished build clears it). It also
 * waits 30 seconds after any finished build (a KV timestamp), so the panel
 * and sends of a running upload do not build once per insert batch; an
 * explicit commit ignores that wait and builds right away.
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

    const isBackedOff = await isKnowledgePackBackedOff(
      input.projectId,
      state.version,
      logger,
    )

    if (isBackedOff) {
      packLog(logger, 'backoff', {
        operation: 'skipped',
        version: state.version,
      })

      return
    }

    const isRecentlyBuilt = await isKnowledgePackRecentlyBuilt(
      input.projectId,
      logger,
    )

    if (isRecentlyBuilt) {
      packLog(logger, 'interval', {
        operation: 'skipped',
        version: state.version,
      })

      return
    }

    await runTrackedBuild(
      {
        userId: input.userId,
        projectId: input.projectId,
        version: state.version,
      },
      logger,
    )
  } catch (exception) {
    try {
      packLog(logger, 'ensure', {
        operation: 'ensure',
        error: exceptionMessage(exception),
      })
    } catch (_loggingException) {
      return
    }
  }
}
