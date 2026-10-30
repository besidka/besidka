import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import type { FileSource } from '#shared/types/files.d'
import { normalizeMediaType } from '#shared/utils/files'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import { deleteOwnedFiles } from '~~/server/utils/files/delete-files'
import { assertFileNameCharacters } from '~~/server/utils/files/file-name'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { persistFile } from '~~/server/utils/files/persist-file'
import { getFilesSourceCondition } from '~~/server/utils/files/source-filter'
import { assertUploadContentLength } from '~~/server/utils/files/upload-request'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'
import { isFileLinkedToKnowledgeSql } from '~~/server/utils/knowledge/linked-files'
import { clampMcpLimit } from '~~/server/utils/mcp/private/chats'
import { sliceMcpKnowledgeText } from '~~/server/utils/mcp/private/projects'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'

type DbClient = ReturnType<typeof useDb>

export const mcpFileListSources = [
  'all',
  'upload',
  'assistant',
  'project',
] as const

export type McpFileListSource = typeof mcpFileListSources[number]

export const MCP_FILE_LIST_DEFAULT_LIMIT = 20
export const MCP_FILE_LIST_MAX_LIMIT = 50
export const MCP_FILE_READ_DEFAULT_CHARS = 50_000
export const MCP_FILE_READ_MAX_CHARS = 100_000
export const MCP_FILE_READ_MAX_BYTES = 2 * 1024 * 1024
export const MCP_FILE_NAME_MAX_CHARS = 255
export const MCP_FILE_TEXT_MAX_CHARS = 200_000
export const MCP_FILE_DELETE_MAX_IDS = 100

const CREATED_FILE_MEDIA_TYPE = 'text/plain'

export interface McpFileSummary {
  id: string
  name: string
  type: string
  size: number
  source: FileSource
  createdAt: string | null
  expiresAt: string | null
  linkedToProject?: true
}

interface McpFileRow {
  id: string
  name: string
  type: string
  size: number
  source: FileSource
  createdAt: Date | null
  expiresAt: Date | null
}

function createFileNotFoundError(fileId: string) {
  return createError({
    status: 404,
    message: `No file with the id "${fileId}". Call list_files to find one.`,
  })
}

function createInvalidInputError(message: string) {
  return createError({ status: 400, message })
}

export function toMcpFileSummary(row: McpFileRow): McpFileSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    source: row.source,
    createdAt: toIsoTimestamp(row.createdAt),
    expiresAt: toIsoTimestamp(row.expiresAt),
  }
}

function normalizeMcpFileName(name: string): string {
  const trimmedName = name.trim()

  if (
    trimmedName.length === 0
    || trimmedName.length > MCP_FILE_NAME_MAX_CHARS
  ) {
    throw createInvalidInputError(
      `The file name must be 1 to ${MCP_FILE_NAME_MAX_CHARS} characters.`,
    )
  }

  assertFileNameCharacters(trimmedName)

  return trimmedName
}

async function resolveOwnedMcpFile(
  db: DbClient,
  userId: number,
  fileId: string,
) {
  if (decodeKnowledgeEntityId(fileId) === null) {
    throw createFileNotFoundError(fileId)
  }

  const file = await db.select({
    id: schema.files.id,
    name: schema.files.name,
    type: schema.files.type,
    size: schema.files.size,
    storageKey: schema.files.storageKey,
  })
    .from(schema.files)
    .where(and(
      eq(schema.files.id, fileId),
      eq(schema.files.userId, userId),
    ))
    .get()

  if (!file) {
    throw createFileNotFoundError(fileId)
  }

  return file
}

export async function listMcpFiles(
  db: DbClient,
  userId: number,
  input: {
    source?: McpFileListSource
    search?: string
    offset?: number
    limit?: number
  },
) {
  const limit = clampMcpLimit(
    input.limit,
    MCP_FILE_LIST_DEFAULT_LIMIT,
    MCP_FILE_LIST_MAX_LIMIT,
  )
  const offset = Math.max(0, Math.trunc(input.offset ?? 0))
  const search = input.search?.trim() ?? ''
  const whereConditions = and(
    eq(schema.files.userId, userId),
    getFilesSourceCondition(input.source ?? 'all'),
    search ? containsLikeEscaped(schema.files.name, search) : undefined,
  )
  const [rows, countRow] = await Promise.all([
    db.select({
      id: schema.files.id,
      name: schema.files.name,
      type: schema.files.type,
      size: schema.files.size,
      source: schema.files.source,
      createdAt: schema.files.createdAt,
      expiresAt: schema.files.expiresAt,
      isLinked: sql<number>`${isFileLinkedToKnowledgeSql(schema.files.id)}`,
    })
      .from(schema.files)
      .where(whereConditions)
      .orderBy(desc(schema.files.createdAt), desc(schema.files.id))
      .offset(offset)
      .limit(limit),
    db.select({ total: sql<number>`count(*)` })
      .from(schema.files)
      .where(whereConditions)
      .get(),
  ])
  const policy = await getEffectiveUserFilePolicy(userId)
  const usedBytes = await getUserStorageUsageBytes(userId)
  const total = countRow?.total ?? 0

  return {
    files: rows.map((row) => {
      const summary = toMcpFileSummary(row)

      return row.isLinked ? { ...summary, linkedToProject: true } : summary
    }),
    total,
    offset,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
    storage: {
      usedBytes,
      totalBytes: policy.maxStorageBytes,
      retentionDays: policy.fileRetentionDays,
      tier: policy.tier,
    },
  }
}

export async function readMcpFile(
  db: DbClient,
  userId: number,
  input: { fileId: string, offset?: number, maxChars?: number },
) {
  const file = await resolveOwnedMcpFile(db, userId, input.fileId)
  const mediaType = normalizeMediaType(file.type)

  if (!mediaType.startsWith('text/')) {
    throw createInvalidInputError(
      `Only text files can be read here; this is ${file.type}.`,
    )
  }

  if (file.size > MCP_FILE_READ_MAX_BYTES) {
    throw createInvalidInputError(
      `This file is ${file.size} bytes, more than the ${MCP_FILE_READ_MAX_BYTES} `
      + 'bytes that can be read here.',
    )
  }

  const stored = await useFileStorage().get(file.storageKey)

  if (!stored) {
    throw createError({
      status: 404,
      message: `The stored content of "${file.name}" is missing.`,
    })
  }

  const maxChars = clampMcpLimit(
    input.maxChars,
    MCP_FILE_READ_DEFAULT_CHARS,
    MCP_FILE_READ_MAX_CHARS,
  )

  return {
    id: file.id,
    name: file.name,
    type: file.type,
    ...sliceMcpKnowledgeText(
      await stored.text(),
      input.offset ?? 0,
      maxChars,
    ),
  }
}

/**
 * Stores the text as a library file the same way an upload does: the
 * storage quota check and the retention expiry come from `persistFile`,
 * and a text too large for the remaining quota is refused with the 413 the
 * upload route answers. The media type is always `text/plain`, the one text
 * format the upload allow-list accepts, while the name keeps its extension.
 */
export async function createMcpFile(
  userId: number,
  input: { name: string, text: string },
  logger: LoggerLike,
) {
  const name = normalizeMcpFileName(input.name)

  if (
    input.text.length === 0
    || input.text.length > MCP_FILE_TEXT_MAX_CHARS
  ) {
    throw createInvalidInputError(
      `The text must be 1 to ${MCP_FILE_TEXT_MAX_CHARS} characters.`,
    )
  }

  const fileData = new TextEncoder().encode(input.text)
  const [policy, totalFilesSize] = await Promise.all([
    getEffectiveUserFilePolicy(userId),
    getUserStorageUsageBytes(userId),
  ])

  assertUploadContentLength(
    String(fileData.byteLength),
    policy.maxStorageBytes - totalFilesSize,
  )

  const storedFile = await persistFile({
    userId,
    fileName: name,
    mediaType: CREATED_FILE_MEDIA_TYPE,
    fileData,
    quotaSizeBytes: fileData.byteLength,
    source: 'upload',
    logger,
    policy,
    totalFilesSize,
  })

  return toMcpFileSummary({ ...storedFile, createdAt: new Date() })
}

export async function renameMcpFile(
  db: DbClient,
  userId: number,
  input: { fileId: string, name: string },
) {
  const name = normalizeMcpFileName(input.name)

  if (decodeKnowledgeEntityId(input.fileId) === null) {
    throw createFileNotFoundError(input.fileId)
  }

  const renamed = await db.update(schema.files)
    .set({ name })
    .where(and(
      eq(schema.files.id, input.fileId),
      eq(schema.files.userId, userId),
    ))
    .returning({ id: schema.files.id, name: schema.files.name })
    .get()

  if (!renamed) {
    throw createFileNotFoundError(input.fileId)
  }

  return renamed
}

export async function deleteMcpFiles(
  userId: number,
  input: { fileIds: string[] },
  logger: LoggerLike,
) {
  const fileIds = [...new Set(input.fileIds)]

  if (fileIds.length === 0 || fileIds.length > MCP_FILE_DELETE_MAX_IDS) {
    throw createInvalidInputError(
      `Send 1 to ${MCP_FILE_DELETE_MAX_IDS} file ids per call.`,
    )
  }

  const malformedIds = fileIds.filter((fileId) => {
    return decodeKnowledgeEntityId(fileId) === null
  })
  const wellFormedIds = fileIds.filter((fileId) => {
    return !malformedIds.includes(fileId)
  })
  const result = await deleteOwnedFiles({
    userId,
    fileIds: wellFormedIds,
    logger,
  })

  return {
    deleted: result.deleted,
    skipped: [
      ...[...malformedIds, ...result.notFound].map((id) => {
        return { id, reason: 'not_found' as const }
      }),
      ...result.failed.map((id) => {
        return { id, reason: 'storage_error' as const }
      }),
      ...result.errored.map((id) => {
        return { id, reason: 'error' as const }
      }),
    ],
  }
}
