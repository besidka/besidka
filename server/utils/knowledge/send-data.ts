import { and, asc, eq } from 'drizzle-orm'
import type {
  KnowledgeItem,
  KnowledgeMode,
  KnowledgePackHeader,
  KnowledgePackLine,
} from '#shared/types/project-knowledge.d'
import {
  knowledgePackHeaderSchema,
  knowledgePackLineSchema,
} from '#shared/utils/project-knowledge-schemas'
import * as schema from '~~/server/db/schema'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { knowledgePackKey } from '~~/server/utils/knowledge/storage-keys'

export interface KnowledgeSendItem extends KnowledgeItem {
  storageKey: string | null
}

export interface KnowledgeSendPack {
  header: KnowledgePackHeader
  lines: KnowledgePackLine[]
}

export interface KnowledgeSendData {
  state: {
    mode: KnowledgeMode | null
    version: number
    packVersion: number | null
  }
  items: KnowledgeSendItem[]
  loadPack: () => Promise<KnowledgeSendPack | null>
}

const PACK_MISSING_MESSAGE = 'pack-object-missing'
const PACK_HEADER_INVALID_MESSAGE = 'pack-header-invalid'
const PACK_LINE_INVALID_MESSAGE = 'pack-line-invalid'
const PACK_UNREADABLE_MESSAGE = 'pack-unreadable'

class KnowledgePackFormatError extends Error {}

function toIsoString(value: Date): string {
  return value.toISOString()
}

async function readGzipText(body: ReadableStream): Promise<string> {
  const decompressed = body.pipeThrough(new DecompressionStream('gzip'))

  return new Response(decompressed).text()
}

function parsePackLine(rawLine: string, message: string): unknown {
  try {
    return JSON.parse(rawLine)
  } catch (_exception) {
    throw new KnowledgePackFormatError(message)
  }
}

function parsePack(text: string): KnowledgeSendPack {
  const rawLines = text.split('\n').filter((rawLine) => {
    return rawLine.trim().length > 0
  })
  const [rawHeader, ...rawChunks] = rawLines

  if (rawHeader === undefined) {
    throw new KnowledgePackFormatError(PACK_HEADER_INVALID_MESSAGE)
  }

  const header = knowledgePackHeaderSchema.safeParse(
    parsePackLine(rawHeader, PACK_HEADER_INVALID_MESSAGE),
  )

  if (!header.success) {
    throw new KnowledgePackFormatError(PACK_HEADER_INVALID_MESSAGE)
  }

  const lines = rawChunks.map((rawChunk) => {
    const line = knowledgePackLineSchema.safeParse(
      parsePackLine(rawChunk, PACK_LINE_INVALID_MESSAGE),
    )

    if (!line.success) {
      throw new KnowledgePackFormatError(PACK_LINE_INVALID_MESSAGE)
    }

    return line.data
  })

  return { header: header.data, lines }
}

function logPackFailure(
  exception: unknown,
  logger: LoggerLike | undefined,
): void {
  const message = exception instanceof KnowledgePackFormatError
    ? exception.message
    : exceptionMessage(exception)

  logger?.set({ attributes: { knowledge: { error: message } } })
}

async function readPack(input: {
  userId: number
  projectId: number
  packVersion: number
}): Promise<KnowledgeSendPack> {
  const storage = useFileStorage()
  const object = await storage.get(
    knowledgePackKey(input.userId, input.projectId, input.packVersion),
  )

  if (!object) {
    throw new KnowledgePackFormatError(PACK_MISSING_MESSAGE)
  }

  let text: string

  try {
    text = await readGzipText(object.body as ReadableStream)
  } catch (_exception) {
    throw new KnowledgePackFormatError(PACK_UNREADABLE_MESSAGE)
  }

  return parsePack(text)
}

function createPackLoader(input: {
  userId: number
  projectId: number
  packVersion: number | null
  logger?: LoggerLike
}): () => Promise<KnowledgeSendPack | null> {
  let memoized: Promise<KnowledgeSendPack | null> | null = null

  return () => {
    if (memoized) {
      return memoized
    }

    if (input.packVersion === null) {
      memoized = Promise.resolve(null)

      return memoized
    }

    const packVersion = input.packVersion

    memoized = readPack({
      userId: input.userId,
      projectId: input.projectId,
      packVersion,
    }).catch((exception: unknown) => {
      logPackFailure(exception, input.logger)

      return null
    })

    return memoized
  }
}

type ItemRow = typeof schema.projectKnowledgeItems.$inferSelect

function toSendItem(row: {
  item: ItemRow
  storageKey: string | null
}): KnowledgeSendItem {
  const { item } = row

  return {
    id: item.id,
    projectId: encodePublicId(item.projectId),
    kind: item.kind,
    fileId: item.fileId === null ? null : encodePublicId(item.fileId),
    title: item.title,
    description: item.description,
    relativePath: item.relativePath,
    folderId: item.folderId,
    mediaType: item.mediaType,
    sizeBytes: item.sizeBytes,
    pageCount: item.pageCount,
    textBytes: item.textBytes,
    latinChars: item.latinChars,
    cyrillicChars: item.cyrillicChars,
    otherChars: item.otherChars,
    extractStatus: item.extractStatus,
    extractError: item.extractError,
    extractor: item.extractor,
    sendAsNativePdf: item.sendAsNativePdf ?? false,
    pinned: item.pinned ?? false,
    createdAt: toIsoString(item.createdAt),
    updatedAt: toIsoString(item.updatedAt),
    storageKey: row.storageKey,
  }
}

async function queryKnowledgeSendData(input: {
  userId: number
  projectId: number
  logger?: LoggerLike
}): Promise<KnowledgeSendData | null> {
  const db = useDb()
  const rows = await db
    .select({
      item: schema.projectKnowledgeItems,
      storageKey: schema.files.storageKey,
    })
    .from(schema.projectKnowledgeItems)
    .leftJoin(
      schema.files,
      and(
        eq(schema.projectKnowledgeItems.fileId, schema.files.id),
        eq(schema.files.userId, input.userId),
      ),
    )
    .where(and(
      eq(schema.projectKnowledgeItems.userId, input.userId),
      eq(schema.projectKnowledgeItems.projectId, input.projectId),
    ))
    .orderBy(asc(schema.projectKnowledgeItems.id))

  if (rows.length === 0) {
    return null
  }

  const [project] = await db
    .select({
      mode: schema.projects.knowledgeMode,
      version: schema.projects.knowledgeVersion,
      packVersion: schema.projects.knowledgePackVersion,
    })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, encodePublicId(input.projectId)),
      eq(schema.projects.userId, input.userId),
    ))
    .limit(1)

  if (!project) {
    return null
  }

  return {
    state: {
      mode: project.mode,
      version: project.version ?? 0,
      packVersion: project.packVersion,
    },
    items: rows.map(toSendItem),
    loadPack: createPackLoader({
      userId: input.userId,
      projectId: input.projectId,
      packVersion: project.packVersion,
      logger: input.logger,
    }),
  }
}

/**
 * The only K2 module that reads knowledge from D1 and R2. The cheap items
 * query runs first and returns null for a project without items, so a
 * project that never used knowledge costs one D1 read and no R2 call. The
 * pack is fetched only when `loadPack()` is called, once per call of this
 * function. Any D1, read, gunzip or validation failure resolves to null with
 * a message-only log entry, so knowledge never fails a send.
 */
export async function loadKnowledgeSendData(input: {
  userId: number
  projectId: number
  logger?: LoggerLike
}): Promise<KnowledgeSendData | null> {
  try {
    return await queryKnowledgeSendData(input)
  } catch (exception) {
    input.logger?.set({
      attributes: { knowledge: { error: exceptionMessage(exception) } },
    })

    return null
  }
}
