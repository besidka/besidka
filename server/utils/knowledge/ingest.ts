import { createError } from 'evlog'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { z } from 'zod'
import type {
  KnowledgeCharCounts,
  KnowledgeCommitResponse,
  KnowledgeItem,
  KnowledgeMode,
} from '#shared/types/project-knowledge.d'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import { countKnowledgeChars } from '#shared/utils/project-knowledge-budget'
import {
  getKnowledgeRelativePathIssue,
  normalizeKnowledgeRelativePath,
  parseKnowledgeRelativePath,
} from '#shared/utils/project-knowledge-path'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  knowledgeTextByteLength,
} from '#shared/utils/project-knowledge-schemas'
import type {
  knowledgeItemPatchSchema,
  knowledgeItemsBatchCreateSchema,
  knowledgeNoteCreateSchema,
  knowledgeNoteUpdateSchema,
} from '#shared/utils/project-knowledge-schemas'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import * as schema from '~~/server/db/schema'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  getEffectiveRetentionDays,
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  countUserKnowledgeItems,
  getKnowledgeProjectState,
  toKnowledgeItemWire,
} from '~~/server/utils/knowledge/items'
import type { KnowledgeItemRow } from '~~/server/utils/knowledge/items'
import {
  getKnowledgeRetentionExpiresAt,
} from '~~/server/utils/knowledge/linked-files'
import {
  commitKnowledgeChange,
  ensureKnowledgePackFresh,
} from '~~/server/utils/knowledge/pack'
import {
  deleteKnowledgeItemText,
  putKnowledgeItemText,
} from '~~/server/utils/knowledge/text-store'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'

const MAX_IDS_PER_STATEMENT = 90
const UNIQUE_VIOLATION_MARKER = 'UNIQUE constraint failed'
const MAX_ERROR_CAUSE_DEPTH = 5
const CONTROL_OR_SEPARATOR_GLOBAL_PATTERN = /[\p{Cc}\u2028\u2029]/gu
const FORMAT_CHARACTER_PATTERN = /\p{Cf}/u
const FORMAT_CHARACTER_GLOBAL_PATTERN = /\p{Cf}/gu
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/
const MAX_MEDIA_TYPE_CHARS = 100
const EXTRACT_ERROR_PATTERN = /^[a-z0-9-]{1,64}$/
const ALLOWED_CONTROL_CODES = new Set([9, 10, 12, 13])
const NOTE_MEDIA_TYPE = 'text/markdown'
const UNTITLED_TITLE = 'Untitled'

type KnowledgeItemsBatchInput = z.infer<
  typeof knowledgeItemsBatchCreateSchema
>
type KnowledgeNoteCreateInput = z.infer<typeof knowledgeNoteCreateSchema>
type KnowledgeNoteUpdateInput = z.infer<typeof knowledgeNoteUpdateSchema>
type KnowledgeItemPatchInput = z.infer<typeof knowledgeItemPatchSchema>
type NewKnowledgeItemValues = typeof schema.projectKnowledgeItems.$inferInsert

export interface KnowledgeIngestContext {
  userId: number
  projectId: number
  logger: LoggerLike
}

export interface KnowledgeCommitResult {
  version: number
  packVersion: number | null
}

export interface KnowledgeItemsBatchResult extends KnowledgeCommitResult {
  items: KnowledgeItem[]
  skipped: Array<{ index: number, reason: 'duplicate' }>
}

export interface KnowledgeRemovalTarget {
  itemId: number
  fileId: number | null
}

interface PreparedKnowledgeItem {
  index: number
  input: KnowledgeItemsBatchInput['items'][number]
  title: string | null
  relativePath: string | null
  mediaType: string | null
  extractError: string | null
  textBytes: number
  charCounts: KnowledgeCharCounts
}

interface LinkedFileRow {
  id: string
  name: string
  size: number
  type: string
  expiresAt: Date | null
  isLinked: number
}

interface LinkedFileSnapshot {
  publicId: string
  expiresAt: Date | null
}

interface NewKnowledgeRow {
  values: NewKnowledgeItemValues
  text: string
}

interface ConflictDescription {
  message: string
  why: string
  fix: string
}

interface ProjectFingerprint {
  contentHash: string | null
  textBytes: number
}

function groupIds<T>(ids: T[]): T[][] {
  const groups: T[][] = []

  for (let start = 0; start < ids.length; start += MAX_IDS_PER_STATEMENT) {
    groups.push(ids.slice(start, start + MAX_IDS_PER_STATEMENT))
  }

  return groups
}

function isUniqueViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return false
    }

    if (current.message.includes(UNIQUE_VIOLATION_MARKER)) {
      return true
    }

    current = current.cause
  }

  return false
}

function createInvalidInputError(why: string, fix: string) {
  return createError({
    message: 'Invalid request body',
    status: 400,
    why,
    fix,
  })
}

function createConflictError(conflict: ConflictDescription) {
  return createError({
    message: conflict.message,
    status: 409,
    why: conflict.why,
    fix: conflict.fix,
  })
}

function createQuotaExceededError() {
  return createError({
    message: 'Not enough storage space. Please delete some files.',
    status: 413,
    why: 'The upload is larger than the remaining storage quota',
    fix: 'Delete some files or upload a smaller file',
  })
}

function createUserItemLimitError(existingItems: number) {
  return createError({
    message: 'Knowledge item limit reached',
    status: 422,
    why: `An account holds at most ${KNOWLEDGE_LIMITS.maxItemsPerUser} knowledge`
      + ` items across all projects and it has ${existingItems}`,
    fix: 'Remove items from other projects before adding more',
  })
}

function createProjectLimitError(why: string, fix: string) {
  return createError({
    message: 'Project knowledge limit reached',
    status: 422,
    why,
    fix,
  })
}

function createItemSaveError() {
  return createError({
    message: 'Failed to save the knowledge item',
    status: 500,
    why: 'Storing the item text or its metadata failed',
    fix: 'Try again in a moment',
  })
}

function createCommitError() {
  return createError({
    message: 'Failed to update the project knowledge index',
    status: 500,
    why: 'Committing the knowledge change did not complete',
    fix: 'Try again in a moment',
  })
}

function recordKnowledgeError(
  logger: LoggerLike,
  operation: string,
  exception: unknown,
): void {
  logger.set({
    attributes: {
      knowledge: {
        operation,
        error: exceptionMessage(exception),
      },
    },
  })
}

/**
 * NFC-normalises a client string so visually identical titles, paths and
 * descriptions compare and store identically.
 */
export function normalizeKnowledgeString(value: string): string {
  return value.normalize('NFC')
}

function assertNoFormatCharacters(value: string, label: string): void {
  if (FORMAT_CHARACTER_PATTERN.test(value)) {
    throw createInvalidInputError(
      `${label} contains invisible formatting characters`,
      `Remove the invisible characters from the ${label.toLowerCase()}`,
    )
  }
}

function normalizeKnowledgeTitle(value: string): string {
  const title = normalizeKnowledgeString(value).trim()

  if (title.length === 0 || title.length > KNOWLEDGE_LIMITS.maxTitleChars) {
    throw createInvalidInputError(
      `Title must be 1 to ${KNOWLEDGE_LIMITS.maxTitleChars} characters`,
      'Shorten the title',
    )
  }

  assertNoFormatCharacters(title, 'Title')

  return title
}

function normalizeKnowledgeDescription(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const description = normalizeKnowledgeString(value).trim()

  if (description.length > KNOWLEDGE_LIMITS.maxDescriptionChars) {
    throw createInvalidInputError(
      `Description must be at most ${KNOWLEDGE_LIMITS.maxDescriptionChars}`
      + ' characters',
      'Shorten the description',
    )
  }

  assertNoFormatCharacters(description, 'Description')

  return description.length === 0 ? null : description
}

/**
 * Validates a folder-relative path with the shared client and server rules
 * (`parseKnowledgeRelativePath`) and rejects invisible formatting characters
 * on top. A rejected path is a 400 whose `why` carries the shared issue
 * text. The path is stored as metadata only and is never part of an R2 key.
 */
export function assertKnowledgeRelativePath(value: string): string {
  const relativePath = parseKnowledgeRelativePath(value)

  if (relativePath === null) {
    const issue = getKnowledgeRelativePathIssue(
      normalizeKnowledgeRelativePath(value),
    )

    throw createInvalidInputError(
      issue ?? 'Path is too long',
      'Use a plain relative path such as docs/guide.md',
    )
  }

  assertNoFormatCharacters(relativePath, 'Path')

  return relativePath
}

/**
 * Rejects text with C0 control characters other than tab, newline, carriage
 * return and form feed: each inflates six times in JSON and can
 * wedge a pack build.
 */
function assertKnowledgeText(text: string): void {
  if (!/\p{Cc}/u.test(text)) {
    return
  }

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0

    if (codePoint < 32 && !ALLOWED_CONTROL_CODES.has(codePoint)) {
      throw createInvalidInputError(
        'The text contains control characters',
        'Remove the control characters and try again',
      )
    }
  }
}

function assertKnowledgeMediaType(
  mediaType: string | null | undefined,
): string | null {
  if (mediaType === null || mediaType === undefined) {
    return null
  }

  if (
    mediaType.length > MAX_MEDIA_TYPE_CHARS
    || !MEDIA_TYPE_PATTERN.test(mediaType)
  ) {
    throw createInvalidInputError(
      'The media type is not a valid type/subtype',
      'Send a media type such as text/markdown',
    )
  }

  return mediaType
}

function assertExtractError(
  extractError: string | null | undefined,
): string | null {
  if (extractError === null || extractError === undefined) {
    return null
  }

  if (!EXTRACT_ERROR_PATTERN.test(extractError)) {
    throw createInvalidInputError(
      'The extraction error must be a short lowercase code',
      'Send a code such as no-text or parse-failed',
    )
  }

  return extractError
}

function toFileTitle(fileName: string): string {
  const title = normalizeKnowledgeString(fileName)
    .replace(CONTROL_OR_SEPARATOR_GLOBAL_PATTERN, ' ')
    .replace(FORMAT_CHARACTER_GLOBAL_PATTERN, '')
    .trim()
    .slice(0, KNOWLEDGE_LIMITS.maxTitleChars)
    .trim()

  return title.length === 0 ? UNTITLED_TITLE : title
}

/**
 * SHA-256 of the text as lowercase hex, the same shape the client sends as
 * `contentHash`. Notes are hashed server-side so the per-project unique
 * index also rejects an identical note body.
 */
export function hashKnowledgeText(text: string): Promise<string> {
  return sha256Hex(text)
}

function isPdfOrImage(mediaType: string): boolean {
  return mediaType === 'application/pdf' || mediaType.startsWith('image/')
}

async function readProjectFingerprints(
  context: KnowledgeIngestContext,
): Promise<ProjectFingerprint[]> {
  return await useDb()
    .select({
      contentHash: schema.projectKnowledgeItems.contentHash,
      textBytes: schema.projectKnowledgeItems.textBytes,
    })
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.userId, context.userId),
      eq(schema.projectKnowledgeItems.projectId, context.projectId),
    ))
}

function sumTextBytes(fingerprints: ProjectFingerprint[]): number {
  return fingerprints.reduce((total, fingerprint) => {
    return total + fingerprint.textBytes
  }, 0)
}

/**
 * The cheap pre-check that gives readable 422 and 413 errors on the common
 * path. It is not the enforcement: parallel requests all pass it, so every
 * write is also guarded in SQL (see `buildGuardedInsert`). Returns the
 * user's storage limit for those guards.
 */
async function assertKnowledgeCapacity(
  context: KnowledgeIngestContext,
  input: {
    existing: ProjectFingerprint[]
    newItems: number
    newTextBytes: number
    replacedTextBytes: number
  },
): Promise<number> {
  const existingTextBytes = sumTextBytes(input.existing)
  const addedTextBytes = input.newTextBytes - input.replacedTextBytes

  if (
    input.newItems > 0
    && input.existing.length + input.newItems
    > KNOWLEDGE_LIMITS.maxItemsPerProject
  ) {
    throw createProjectLimitError(
      `A project holds at most ${KNOWLEDGE_LIMITS.maxItemsPerProject} items`
      + ` and it has ${input.existing.length}`,
      'Remove some items before adding more',
    )
  }

  if (
    addedTextBytes > 0
    && existingTextBytes + addedTextBytes
    > KNOWLEDGE_LIMITS.maxProjectTextBytes
  ) {
    throw createProjectLimitError(
      `A project holds at most ${KNOWLEDGE_LIMITS.maxProjectTextBytes} bytes`
      + ` of text and it has ${existingTextBytes}`,
      'Remove some items or add smaller ones',
    )
  }

  if (input.newItems > 0) {
    const userItems = await countUserKnowledgeItems(context.userId)

    if (userItems + input.newItems > KNOWLEDGE_LIMITS.maxItemsPerUser) {
      throw createUserItemLimitError(userItems)
    }
  }

  const policy = await getEffectiveUserFilePolicy(context.userId)

  if (addedTextBytes <= 0) {
    return policy.maxStorageBytes
  }

  const usedBytes = await getUserStorageUsageBytes(context.userId)
  const remainingBytes = Math.max(policy.maxStorageBytes - usedBytes, 0)

  if (addedTextBytes > remainingBytes) {
    throw createQuotaExceededError()
  }

  return policy.maxStorageBytes
}

async function loadLinkableFiles(
  context: KnowledgeIngestContext,
  filePublicIds: string[],
): Promise<Map<string, LinkedFileRow>> {
  const rows = new Map<string, LinkedFileRow>()

  if (filePublicIds.length === 0) {
    return rows
  }

  const fetched = await useDb()
    .select({
      id: schema.files.id,
      name: schema.files.name,
      size: schema.files.size,
      type: schema.files.type,
      expiresAt: schema.files.expiresAt,
      isLinked: sql<number>`exists (
        select 1 from project_knowledge_items as knowledge_link
        where knowledge_link.file_id = ${schema.files.id}
          and knowledge_link.project_id = ${context.projectId}
      )`,
    })
    .from(schema.files)
    .where(and(
      eq(schema.files.userId, context.userId),
      inArray(schema.files.id, filePublicIds),
    ))

  for (const row of fetched) {
    rows.set(row.id, row)
  }

  return rows
}

function resolveRequestedFiles(
  items: KnowledgeItemsBatchInput['items'],
): string[] {
  const filePublicIds: string[] = []

  for (const item of items) {
    if (!item.fileId) {
      continue
    }

    if (decodeKnowledgeEntityId(item.fileId) === null) {
      throw createError({
        message: 'File not found',
        status: 404,
        why: 'The file does not exist in your library',
        fix: 'Pick a file from your library',
      })
    }

    if (filePublicIds.includes(item.fileId)) {
      throw createConflictError({
        message: 'File already added',
        why: 'The same file appears twice in this request',
        fix: 'Add each file once',
      })
    }

    filePublicIds.push(item.fileId)
  }

  return filePublicIds
}

function assertFilesLinkable(
  filePublicIds: string[],
  files: Map<string, LinkedFileRow>,
): void {
  for (const filePublicId of filePublicIds) {
    const file = files.get(filePublicId)

    if (!file) {
      throw createError({
        message: 'File not found',
        status: 404,
        why: 'The file does not exist in your library',
        fix: 'Pick a file from your library',
      })
    }

    if (!isPdfOrImage(file.type)) {
      throw createInvalidInputError(
        'Only PDF and image files can be kept as originals',
        'Send the extracted text without a file id',
      )
    }

    if (file.isLinked) {
      throw createConflictError({
        message: 'File already added',
        why: 'The file is already part of this project knowledge',
        fix: 'Remove the existing item first, or pick another file',
      })
    }
  }
}

function prepareKnowledgeItems(
  items: KnowledgeItemsBatchInput['items'],
): PreparedKnowledgeItem[] {
  return items.map((input, index) => {
    assertKnowledgeText(input.text)

    return {
      index,
      input,
      title: input.title ? normalizeKnowledgeTitle(input.title) : null,
      relativePath: input.relativePath
        ? assertKnowledgeRelativePath(input.relativePath)
        : null,
      mediaType: assertKnowledgeMediaType(input.mediaType),
      extractError: assertExtractError(input.extractError),
      textBytes: knowledgeTextByteLength(input.text),
      charCounts: countKnowledgeChars(input.text),
    }
  })
}

function buildFileItemRow(
  context: KnowledgeIngestContext,
  prepared: PreparedKnowledgeItem,
  file: LinkedFileRow | undefined,
): NewKnowledgeRow {
  const { input } = prepared
  const fileId = input.fileId ? decodeKnowledgeEntityId(input.fileId) : null
  const isReady = input.extractStatus === 'ready'

  return {
    text: input.text,
    values: {
      userId: context.userId,
      projectId: context.projectId,
      kind: 'file',
      fileId,
      title: prepared.title ?? toFileTitle(file?.name ?? UNTITLED_TITLE),
      description: null,
      relativePath: prepared.relativePath,
      folderId: input.folderId ?? null,
      mediaType: file?.type ?? prepared.mediaType,
      sizeBytes: file?.size ?? null,
      pageCount: input.pageCount ?? null,
      contentHash: input.contentHash ?? null,
      textBytes: prepared.textBytes,
      latinChars: prepared.charCounts.latinChars,
      cyrillicChars: prepared.charCounts.cyrillicChars,
      otherChars: prepared.charCounts.otherChars,
      extractStatus: input.extractStatus,
      extractError: isReady ? null : prepared.extractError,
      extractor: input.extractor,
    },
  }
}

async function selectItemRows(
  context: KnowledgeIngestContext,
  publicIds: string[],
): Promise<Map<string, KnowledgeItemRow>> {
  const rows = new Map<string, KnowledgeItemRow>()

  for (const group of groupIds(publicIds)) {
    const fetched = await useDb()
      .select()
      .from(schema.projectKnowledgeItems)
      .where(and(
        inArray(schema.projectKnowledgeItems.id, group),
        eq(schema.projectKnowledgeItems.userId, context.userId),
        eq(schema.projectKnowledgeItems.projectId, context.projectId),
      ))

    for (const row of fetched) {
      rows.set(row.id, row)
    }
  }

  return rows
}

async function rollbackNewKnowledgeRows(
  context: KnowledgeIngestContext,
  input: {
    insertedIds: string[]
    objectIds: number[]
    linkedFiles: LinkedFileSnapshot[]
  },
): Promise<void> {
  const { logger } = context
  const db = useDb()

  for (const itemId of input.objectIds) {
    try {
      await deleteKnowledgeItemText({
        userId: context.userId,
        projectId: context.projectId,
        itemId,
      })
    } catch (exception) {
      recordKnowledgeError(logger, 'rollback-object', exception)
    }
  }

  for (const group of groupIds(input.insertedIds)) {
    try {
      await db
        .delete(schema.projectKnowledgeItems)
        .where(and(
          inArray(schema.projectKnowledgeItems.id, group),
          eq(schema.projectKnowledgeItems.userId, context.userId),
          eq(schema.projectKnowledgeItems.projectId, context.projectId),
        ))
    } catch (exception) {
      recordKnowledgeError(logger, 'rollback-rows', exception)
    }
  }

  for (const file of input.linkedFiles) {
    try {
      await db
        .update(schema.files)
        .set({ expiresAt: file.expiresAt })
        .where(and(
          eq(schema.files.id, file.publicId),
          eq(schema.files.userId, context.userId),
        ))
    } catch (exception) {
      recordKnowledgeError(logger, 'rollback-file-expiry', exception)
    }
  }
}

interface GuardLimits {
  maxStorageBytes: number
}

function buildGuardedInsert(
  context: KnowledgeIngestContext,
  values: NewKnowledgeItemValues,
  limits: GuardLimits,
) {
  const { userId, projectId } = context
  const timestamp = Math.floor(Date.now() / 1000)
  const bytes = values.textBytes

  return sql`
    insert into project_knowledge_items (
      created_at, updated_at, user_id, project_id, kind, file_id, title,
      description, relative_path, folder_id, media_type, size_bytes,
      page_count, content_hash, text_bytes, latin_chars, cyrillic_chars,
      other_chars, extract_status, extract_error, extractor
    )
    select
      ${timestamp}, ${timestamp}, ${userId}, ${projectId}, ${values.kind},
      ${values.fileId ?? null}, ${values.title}, ${values.description ?? null},
      ${values.relativePath ?? null}, ${values.folderId ?? null},
      ${values.mediaType ?? null}, ${values.sizeBytes ?? null},
      ${values.pageCount ?? null}, ${values.contentHash ?? null}, ${bytes},
      ${values.latinChars}, ${values.cyrillicChars}, ${values.otherChars},
      ${values.extractStatus}, ${values.extractError ?? null},
      ${values.extractor}
    where exists (
      select 1 from projects where id = ${projectId} and user_id = ${userId}
    )
    and (
      select count(*) from project_knowledge_items
      where project_id = ${projectId} and user_id = ${userId}
    ) < ${KNOWLEDGE_LIMITS.maxItemsPerProject}
    and (
      select count(*) from project_knowledge_items
      where user_id = ${userId}
    ) < ${KNOWLEDGE_LIMITS.maxItemsPerUser}
    and (${bytes} = 0 or (
      select coalesce(sum(text_bytes), 0) from project_knowledge_items
      where project_id = ${projectId} and user_id = ${userId}
    ) + ${bytes} <= ${KNOWLEDGE_LIMITS.maxProjectTextBytes})
    and (${bytes} = 0 or (
      select coalesce(sum(size), 0) from files where user_id = ${userId}
    ) + (
      select coalesce(sum(text_bytes), 0) from project_knowledge_items
      where user_id = ${userId}
    ) + ${bytes} <= ${limits.maxStorageBytes})
    returning id
  `
}

/**
 * Called after a guarded statement affected no row: re-reads the project and
 * re-runs the readable pre-checks against the now-current state, so the
 * caller gets the same 404, 422 or 413 a sequential request would have got.
 * A concurrent change that left room again falls back to a generic 422.
 */
async function throwGuardFailure(
  context: KnowledgeIngestContext,
  needed: { newItems: number, newTextBytes: number, replacedTextBytes: number },
): Promise<never> {
  const project = await useDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      sql`${schema.projects.id} = ${context.projectId}`,
      eq(schema.projects.userId, context.userId),
    ))
    .get()

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
      why: 'The project does not exist or belongs to another account',
      fix: 'Open a project from your project list',
    })
  }

  const existing = await readProjectFingerprints(context)

  await assertKnowledgeCapacity(context, { existing, ...needed })

  throw createProjectLimitError(
    'Another request changed the project knowledge at the same time',
    'Try again in a moment',
  )
}

/**
 * Inserts the rows in one atomic `db.batch()` of guarded INSERTs (each
 * `INSERT ... SELECT ... WHERE <guards> RETURNING id`, because the R2 key
 * needs the integer id and a multi-row VALUES would break the 100-parameter
 * limit). The guards (project owned, item count, project text bytes, user
 * quota) run inside the batch transaction, so each statement sees the rows
 * before it and parallel requests cannot all pass. Linked library files get
 * their expiry cleared in the same batch. A statement that returned no row
 * means a cap or the quota was hit concurrently: the rows that did land and
 * the file expiries are rolled back and the request fails with the 422 or
 * 413 a sequential request would have got. Text objects are then written one
 * after another; when one fails the rows, the objects already written and
 * the file expiries are rolled back and the request fails. A race-time
 * UNIQUE violation rolls the whole batch back and surfaces as a 409.
 */
async function storeNewKnowledgeRows(
  context: KnowledgeIngestContext,
  input: {
    rows: NewKnowledgeRow[]
    linkedFiles: LinkedFileSnapshot[]
    conflict: ConflictDescription
    limits: GuardLimits
  },
): Promise<string[]> {
  const { userId, projectId, logger } = context
  const db = useDb()
  const statements: PromiseLike<unknown>[] = input.rows.map((row) => {
    return db.all(buildGuardedInsert(context, row.values, input.limits))
  })

  if (input.linkedFiles.length > 0) {
    statements.push(
      db
        .update(schema.files)
        .set({ expiresAt: null })
        .where(and(
          eq(schema.files.userId, userId),
          inArray(
            schema.files.id,
            input.linkedFiles.map((file) => {
              return file.publicId
            }),
          ),
        )),
    )
  }

  let results: unknown[]

  try {
    results = await db.batch(
      statements as unknown as [BatchItem<'sqlite'>],
    )
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createConflictError(input.conflict)
    }

    recordKnowledgeError(logger, 'insert-rows', exception)

    throw createItemSaveError()
  }

  const landedIds: Array<string | null> = input.rows.map((_row, index) => {
    const [landed] = results[index] as Array<{ id: number }>

    return landed ? encodePublicId(Number(landed.id)) : null
  })
  const insertedIds = landedIds.filter((insertedId): insertedId is string => {
    return insertedId !== null
  })

  if (insertedIds.length !== input.rows.length) {
    logger.set({
      attributes: {
        knowledge: {
          operation: 'guard-rejected',
          landed: insertedIds.length,
          requested: input.rows.length,
        },
      },
    })

    await rollbackNewKnowledgeRows(context, {
      insertedIds,
      objectIds: [],
      linkedFiles: input.linkedFiles,
    })
    await invalidateStorageCache(userId, logger)

    return await throwGuardFailure(context, {
      newItems: input.rows.length,
      newTextBytes: input.rows.reduce((total, row) => {
        return total + row.values.textBytes
      }, 0),
      replacedTextBytes: 0,
    })
  }

  const objectIds: number[] = []

  try {
    for (const [index, row] of input.rows.entries()) {
      const itemId = decodeKnowledgeEntityId(insertedIds[index])

      if (itemId === null) {
        throw new Error('The database returned an invalid item id')
      }

      if (row.text.length === 0) {
        continue
      }

      objectIds.push(itemId)

      await putKnowledgeItemText({
        userId,
        projectId,
        itemId,
        text: row.text,
      })
    }
  } catch (exception) {
    recordKnowledgeError(logger, 'put-text', exception)

    await rollbackNewKnowledgeRows(context, {
      insertedIds,
      objectIds,
      linkedFiles: input.linkedFiles,
    })
    await invalidateStorageCache(userId, logger)

    throw createItemSaveError()
  }

  await invalidateStorageCache(userId, logger)

  return insertedIds
}

async function readCommitState(
  context: KnowledgeIngestContext,
): Promise<KnowledgeCommitResult> {
  const state = await getKnowledgeProjectState({
    userId: context.userId,
    projectId: context.projectId,
  })

  return {
    version: state?.version ?? 0,
    packVersion: state?.packVersion ?? null,
  }
}

/**
 * Marks inserted items as pending for the pack: bumps `knowledge_version`
 * without building, so a later empty commit (or the next send) sees the pack
 * behind its version and rebuilds it. When the bump fails the rows and text
 * just written are rolled back, so the client's retry starts clean instead
 * of finding duplicates it can no longer commit.
 */
async function markInsertedItemsPending(
  context: KnowledgeIngestContext,
  inserted: { insertedIds: string[], linkedFiles: LinkedFileSnapshot[] },
): Promise<void> {
  try {
    await bumpKnowledgeVersion([context.projectId])
  } catch (exception) {
    recordKnowledgeError(context.logger, 'bump-version', exception)

    await rollbackNewKnowledgeRows(context, {
      insertedIds: inserted.insertedIds,
      objectIds: inserted.insertedIds.flatMap((insertedId) => {
        const itemId = decodeKnowledgeEntityId(insertedId)

        return itemId === null ? [] : [itemId]
      }),
      linkedFiles: inserted.linkedFiles,
    })
    await invalidateStorageCache(context.userId, context.logger)

    throw createCommitError()
  }
}

/**
 * Settles a commit that changed nothing (no item added, none removed). A
 * pack that already matches the version is returned as is. A stale pack of a
 * project that has been committed before is rebuilt through the lazy path,
 * which never bumps `knowledge_version` and honours the build backoff, so
 * repeating an empty commit cannot churn builds. It is an explicit commit, so
 * it skips the 30 second wait the panel and send paths observe. Only a
 * project that has never been committed (version 0) takes the full commit
 * once.
 */
async function settleUnchangedCommit(
  context: KnowledgeIngestContext,
): Promise<KnowledgeCommitResult> {
  const state = await readCommitState(context)

  if (state.packVersion === state.version) {
    return state
  }

  if (state.version === 0) {
    return await commitKnowledgeProject(context)
  }

  await ensureKnowledgePackFresh({
    userId: context.userId,
    projectId: context.projectId,
    ignoreBuildInterval: true,
    logger: context.logger,
  })

  return await readCommitState(context)
}

/**
 * Runs the commit flow (version bump, optional removals, pack build) and
 * maps any failure to a retryable 500. The committed rows stay in D1, so
 * the client can simply call the commit route again.
 */
export async function commitKnowledgeProject(
  context: KnowledgeIngestContext,
  removeItemIds: number[] = [],
): Promise<KnowledgeCommitResult> {
  try {
    return await commitKnowledgeChange({
      userId: context.userId,
      projectId: context.projectId,
      removeItemIds,
      logger: context.logger,
    })
  } catch (exception) {
    recordKnowledgeError(context.logger, 'commit', exception)

    throw createCommitError()
  }
}

/**
 * Creates the items of one upload batch. Order: sanitise, duplicate
 * `contentHash` skipping (a skipped item is never looked at again, so its
 * `fileId` is neither validated nor linked), file checks for the accepted
 * items (404 foreign or missing, 400 not a PDF or image, 409 already linked
 * to this project), per-project and per-user caps (422), user quota (413),
 * then guarded rows, text objects and the optional commit. `commit: true`
 * on a batch where every item was a duplicate changes nothing, so it only
 * settles a stale pack (no version bump). A batch without `commit` that
 * inserted rows bumps `knowledge_version` (no build), so a later empty
 * commit rebuilds the pack. Counts and byte sizes are
 * recomputed here and never read from the client.
 */
export async function ingestKnowledgeItems(
  context: KnowledgeIngestContext,
  input: KnowledgeItemsBatchInput,
): Promise<KnowledgeItemsBatchResult> {
  const prepared = prepareKnowledgeItems(input.items)
  const existing = await readProjectFingerprints(context)
  const knownHashes = new Set<string>()

  for (const fingerprint of existing) {
    if (fingerprint.contentHash) {
      knownHashes.add(fingerprint.contentHash)
    }
  }

  const skipped: KnowledgeItemsBatchResult['skipped'] = []
  const accepted: PreparedKnowledgeItem[] = []

  for (const item of prepared) {
    const contentHash = item.input.contentHash

    if (contentHash && knownHashes.has(contentHash)) {
      skipped.push({ index: item.index, reason: 'duplicate' })

      continue
    }

    if (contentHash) {
      knownHashes.add(contentHash)
    }

    accepted.push(item)
  }

  if (accepted.length === 0) {
    const state = input.commit
      ? await settleUnchangedCommit(context)
      : await readCommitState(context)

    context.logger.set({
      attributes: {
        knowledge: {
          operation: 'ingest',
          created: 0,
          skipped: skipped.length,
          committed: input.commit === true,
        },
      },
    })

    return { items: [], skipped, ...state }
  }

  const filePublicIds = resolveRequestedFiles(
    accepted.map((item) => {
      return item.input
    }),
  )
  const files = await loadLinkableFiles(context, filePublicIds)

  assertFilesLinkable(filePublicIds, files)

  const newTextBytes = accepted.reduce((total, item) => {
    return total + item.textBytes
  }, 0)
  const maxStorageBytes = await assertKnowledgeCapacity(context, {
    existing,
    newItems: accepted.length,
    newTextBytes,
    replacedTextBytes: 0,
  })
  const rows = accepted.map((item) => {
    return buildFileItemRow(
      context,
      item,
      item.input.fileId ? files.get(item.input.fileId) : undefined,
    )
  })
  const linkedFiles: LinkedFileSnapshot[] = filePublicIds.map((publicId) => {
    return { publicId, expiresAt: files.get(publicId)?.expiresAt ?? null }
  })

  const insertedIds = await storeNewKnowledgeRows(context, {
    rows,
    linkedFiles,
    limits: { maxStorageBytes },
    conflict: {
      message: 'Item already added',
      why: 'An identical item or file was added while the request ran',
      fix: 'Refresh the project knowledge list and try again',
    },
  })
  if (!input.commit) {
    await markInsertedItemsPending(context, { insertedIds, linkedFiles })
  }

  const savedRows = await selectItemRows(context, insertedIds)
  const items = insertedIds.flatMap((insertedId) => {
    const row = savedRows.get(insertedId)

    return row ? [toKnowledgeItemWire(row)] : []
  })
  const state = input.commit
    ? await commitKnowledgeProject(context)
    : await readCommitState(context)

  context.logger.set({
    attributes: {
      knowledge: {
        operation: 'ingest',
        created: items.length,
        skipped: skipped.length,
        textBytes: newTextBytes,
        linkedFiles: linkedFiles.length,
        committed: input.commit === true,
      },
    },
  })

  return { items, skipped, ...state }
}

async function assertNoteBody(body: string): Promise<string> {
  assertKnowledgeText(body)

  if (body.trim().length === 0) {
    throw createInvalidInputError(
      'The note body is empty',
      'Write some text in the note',
    )
  }

  return await hashKnowledgeText(body)
}

const duplicateNoteConflict: ConflictDescription = {
  message: 'This note already exists',
  why: 'A note with an identical body is already in this project',
  fix: 'Edit the existing note instead',
}

/**
 * Creates a note: validates the body, rejects a body identical to another
 * item of the project (409), enforces the caps and quota, stores row and
 * text like a file item and commits the change.
 */
export async function createKnowledgeNote(
  context: KnowledgeIngestContext,
  input: KnowledgeNoteCreateInput,
): Promise<KnowledgeItem> {
  const title = normalizeKnowledgeTitle(input.title)
  const description = normalizeKnowledgeDescription(input.description)
  const contentHash = await assertNoteBody(input.body)
  const textBytes = knowledgeTextByteLength(input.body)
  const charCounts = countKnowledgeChars(input.body)
  const existing = await readProjectFingerprints(context)
  const isDuplicate = existing.some((fingerprint) => {
    return fingerprint.contentHash === contentHash
  })

  if (isDuplicate) {
    throw createConflictError(duplicateNoteConflict)
  }

  const maxStorageBytes = await assertKnowledgeCapacity(context, {
    existing,
    newItems: 1,
    newTextBytes: textBytes,
    replacedTextBytes: 0,
  })

  const [insertedId] = await storeNewKnowledgeRows(context, {
    rows: [{
      text: input.body,
      values: {
        userId: context.userId,
        projectId: context.projectId,
        kind: 'note',
        fileId: null,
        title,
        description,
        relativePath: null,
        folderId: null,
        mediaType: NOTE_MEDIA_TYPE,
        sizeBytes: null,
        pageCount: null,
        contentHash,
        textBytes,
        latinChars: charCounts.latinChars,
        cyrillicChars: charCounts.cyrillicChars,
        otherChars: charCounts.otherChars,
        extractStatus: 'ready',
        extractError: null,
        extractor: 'note',
      },
    }],
    linkedFiles: [],
    limits: { maxStorageBytes },
    conflict: duplicateNoteConflict,
  })
  const savedRows = await selectItemRows(context, [insertedId!])
  const savedRow = savedRows.get(insertedId!)

  if (!savedRow) {
    throw createItemSaveError()
  }

  await commitKnowledgeProject(context)

  context.logger.set({
    attributes: {
      knowledge: { operation: 'note-create', textBytes },
    },
  })

  return toKnowledgeItemWire(savedRow)
}

function createNoteNotFoundError() {
  return createError({
    message: 'Note not found',
    status: 404,
    why: 'The item is not a note of this project',
    fix: 'Refresh the project knowledge list',
  })
}

async function readUpdatedRow(
  context: KnowledgeIngestContext,
  current: KnowledgeItemRow,
): Promise<KnowledgeItemRow> {
  const rows = await selectItemRows(context, [current.id])
  const row = rows.get(current.id)

  if (!row) {
    throw createNoteNotFoundError()
  }

  return row
}

/**
 * Updates a note. Only a title or body change commits (the index line is
 * read live, so a description edit does not). A changed body is hashed
 * again and checked against the other items of the project (409). Saving a
 * body on a note that is not `ready` (a `text-mismatch` or `text-missing`
 * failure) is a repair: the body is written even when it equals the stored
 * hash, and the row comes back `ready` with its error cleared. The row
 * is updated first, by one guarded UPDATE that enforces the project text cap
 * and the user quota for the growth only, so nothing is written to R2 unless
 * the new size fits; the new text is written second, and when that write
 * fails the row is put back (matched on the update's own `updatedAt`, so a
 * newer edit is never clobbered) and the request fails. The row's
 * `updatedAt` always moves to at least one second past its previous value,
 * so a pack build comparing `updatedAt` sees every change even when two
 * edits land within the same second.
  */
export async function updateKnowledgeNote(
  context: KnowledgeIngestContext,
  current: KnowledgeItemRow,
  input: KnowledgeNoteUpdateInput,
): Promise<KnowledgeItem> {
  if (current.kind !== 'note') {
    throw createNoteNotFoundError()
  }

  const { userId, projectId, logger } = context
  const title = input.title === undefined
    ? current.title
    : normalizeKnowledgeTitle(input.title)
  const description = input.description === undefined
    ? current.description
    : normalizeKnowledgeDescription(input.description)
  const nextHash = input.body === undefined
    ? current.contentHash
    : await assertNoteBody(input.body)
  const isRepair = input.body !== undefined
    && current.extractStatus !== 'ready'
  const isBodyChanged = input.body !== undefined
    && (nextHash !== current.contentHash || isRepair)
  const isTitleChanged = title !== current.title
  const isDescriptionChanged = description !== current.description

  if (!isBodyChanged && !isTitleChanged && !isDescriptionChanged) {
    return toKnowledgeItemWire(current)
  }

  const nextBody = isBodyChanged ? input.body! : null
  const textBytes = nextBody === null
    ? current.textBytes
    : knowledgeTextByteLength(nextBody)
  const charCounts = nextBody === null
    ? {
      latinChars: current.latinChars,
      cyrillicChars: current.cyrillicChars,
      otherChars: current.otherChars,
    }
    : countKnowledgeChars(nextBody)
  const growthBytes = textBytes - current.textBytes
  let maxStorageBytes = 0

  if (isBodyChanged) {
    const existing = await readProjectFingerprints(context)
    const isDuplicate = nextHash !== current.contentHash
      && existing.some((fingerprint) => {
        return fingerprint.contentHash === nextHash
      })

    if (isDuplicate) {
      throw createConflictError(duplicateNoteConflict)
    }

    maxStorageBytes = await assertKnowledgeCapacity(context, {
      existing,
      newItems: 0,
      newTextBytes: textBytes,
      replacedTextBytes: current.textBytes,
    })
  }

  const itemId = decodeKnowledgeEntityId(current.id)

  if (itemId === null) {
    throw createNoteNotFoundError()
  }

  const updatedAtSeconds = Math.max(
    Math.floor(Date.now() / 1000),
    Math.floor(current.updatedAt.getTime() / 1000) + 1,
  )
  let updatedRows: Array<{ id: number }>

  try {
    updatedRows = await useDb().all<{ id: number }>(sql`
      update project_knowledge_items set
        title = ${title},
        description = ${description},
        content_hash = ${nextHash},
        text_bytes = ${textBytes},
        latin_chars = ${charCounts.latinChars},
        cyrillic_chars = ${charCounts.cyrillicChars},
        other_chars = ${charCounts.otherChars},
        extract_status = ${isBodyChanged ? 'ready' : current.extractStatus},
        extract_error = ${isBodyChanged ? null : current.extractError},
        updated_at = ${updatedAtSeconds}
      where id = ${itemId}
        and user_id = ${userId}
        and project_id = ${projectId}
        and (${growthBytes} <= 0 or (
          (
            select coalesce(sum(text_bytes), 0) from project_knowledge_items
            where project_id = ${projectId} and user_id = ${userId}
          ) + ${growthBytes} <= ${KNOWLEDGE_LIMITS.maxProjectTextBytes}
          and (
            select coalesce(sum(size), 0) from files where user_id = ${userId}
          ) + (
            select coalesce(sum(text_bytes), 0) from project_knowledge_items
            where user_id = ${userId}
          ) + ${growthBytes} <= ${maxStorageBytes}
        ))
      returning id
    `)
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createConflictError(duplicateNoteConflict)
    }

    recordKnowledgeError(logger, 'note-update-row', exception)

    throw createItemSaveError()
  }

  if (updatedRows.length === 0) {
    const stillThere = await selectItemRows(context, [current.id])

    if (!stillThere.has(current.id)) {
      throw createNoteNotFoundError()
    }

    return await throwGuardFailure(context, {
      newItems: 0,
      newTextBytes: textBytes,
      replacedTextBytes: current.textBytes,
    })
  }

  async function revertUpdatedRow(): Promise<void> {
    try {
      await useDb().run(sql`
        update project_knowledge_items set
          title = ${current.title},
          description = ${current.description},
          content_hash = ${current.contentHash},
          text_bytes = ${current.textBytes},
          latin_chars = ${current.latinChars},
          cyrillic_chars = ${current.cyrillicChars},
          other_chars = ${current.otherChars},
          extract_status = ${current.extractStatus},
          extract_error = ${current.extractError},
          updated_at = ${Math.floor(current.updatedAt.getTime() / 1000)}
        where id = ${itemId}
          and user_id = ${userId}
          and project_id = ${projectId}
          and updated_at = ${updatedAtSeconds}
      `)
    } catch (exception) {
      recordKnowledgeError(logger, 'note-update-revert-row', exception)
    }
  }

  if (nextBody !== null) {
    try {
      await putKnowledgeItemText({ userId, projectId, itemId, text: nextBody })
    } catch (exception) {
      recordKnowledgeError(logger, 'note-update-text', exception)

      await revertUpdatedRow()
      await invalidateStorageCache(userId, logger)

      throw createItemSaveError()
    }
  }

  if (nextBody !== null) {
    await invalidateStorageCache(userId, logger)
  }

  if (isBodyChanged || isTitleChanged) {
    await commitKnowledgeProject(context)
  }

  logger.set({
    attributes: {
      knowledge: {
        operation: 'note-update',
        bodyChanged: isBodyChanged,
        titleChanged: isTitleChanged,
      },
    },
  })

  return toKnowledgeItemWire(await readUpdatedRow(context, current))
}

/**
 * Updates the metadata of an item (description, pinned, send as native PDF)
 * without a version bump: the index line is read live from D1. Sending as a
 * native PDF is only valid for an item that keeps a PDF original.
 */
export async function updateKnowledgeItemMetadata(
  context: KnowledgeIngestContext,
  current: KnowledgeItemRow,
  input: KnowledgeItemPatchInput,
): Promise<KnowledgeItem> {
  const hasPdfOriginal = current.fileId !== null
    && current.mediaType === 'application/pdf'

  if (input.sendAsNativePdf === true && !hasPdfOriginal) {
    throw createError({
      message: 'Only a PDF original can be sent as a PDF',
      status: 422,
      why: 'This item has no PDF original attached',
      fix: 'Add the PDF from your library to send it as a PDF',
    })
  }

  const values: Partial<NewKnowledgeItemValues> = {}

  if (input.description !== undefined) {
    values.description = normalizeKnowledgeDescription(input.description)
  }

  if (input.sendAsNativePdf !== undefined) {
    values.sendAsNativePdf = input.sendAsNativePdf
  }

  if (input.pinned !== undefined) {
    values.pinned = input.pinned
  }

  const row = await useDb()
    .update(schema.projectKnowledgeItems)
    .set(values)
    .where(and(
      eq(schema.projectKnowledgeItems.id, current.id),
      eq(schema.projectKnowledgeItems.userId, context.userId),
      eq(schema.projectKnowledgeItems.projectId, context.projectId),
    ))
    .returning()
    .get()

  if (!row) {
    throw createError({
      message: 'Knowledge item not found',
      status: 404,
      why: 'The item no longer exists in this project',
      fix: 'Refresh the project knowledge list',
    })
  }

  context.logger.set({
    attributes: {
      knowledge: {
        operation: 'item-patch',
        fields: Object.keys(values),
      },
    },
  })

  return toKnowledgeItemWire(row)
}

/**
 * Stores the project's knowledge mode (`null` clears it back to auto). The
 * mode does not change content, so the knowledge version is not bumped.
 */
export async function updateKnowledgeMode(
  context: KnowledgeIngestContext,
  mode: KnowledgeMode | null,
): Promise<KnowledgeMode | null> {
  const row = await useDb()
    .update(schema.projects)
    .set({ knowledgeMode: mode })
    .where(and(
      sql`${schema.projects.id} = ${context.projectId}`,
      eq(schema.projects.userId, context.userId),
    ))
    .returning({ mode: schema.projects.knowledgeMode })
    .get()

  if (!row) {
    throw createError({
      message: 'Project not found',
      status: 404,
      why: 'The project does not exist or belongs to another account',
      fix: 'Open a project from your project list',
    })
  }

  context.logger.set({
    attributes: {
      knowledge: { operation: 'mode', mode: row.mode ?? 'auto' },
    },
  })

  return row.mode
}

/**
 * Gives library files the tier expiry back once no knowledge item links
 * them any more (`null` for the vip tier), the same computation a new
 * upload gets. A file another project still links stays non-expiring. The
 * linkage is decided in SQL because `files.id` is hashids-typed while
 * `project_knowledge_items.file_id` is a plain integer.
 */
async function restoreUnlinkedFileExpiry(
  context: KnowledgeIngestContext,
  fileIds: number[],
): Promise<void> {
  if (fileIds.length === 0) {
    return
  }

  const retentionDays = await getEffectiveRetentionDays(context.userId)
  const expiresAt = getKnowledgeRetentionExpiresAt(retentionDays)
  const filePublicIds = fileIds.map((fileId) => {
    return encodePublicId(fileId)
  })

  for (const group of groupIds(filePublicIds)) {
    await useDb()
      .update(schema.files)
      .set({ expiresAt })
      .where(and(
        eq(schema.files.userId, context.userId),
        inArray(schema.files.id, group),
        sql`not exists (
          select 1 from project_knowledge_items as knowledge_link
          where knowledge_link.file_id = ${schema.files.id}
        )`,
      ))
  }
}

/**
 * Removes items through the commit flow (text objects, rows, one version
 * bump, pack build), then restores the expiry of library files that lost
 * their last link and refreshes the storage figure. The targets must
 * already be scoped to the project and user by the caller.
 */
export async function removeKnowledgeItems(
  context: KnowledgeIngestContext,
  targets: KnowledgeRemovalTarget[],
): Promise<KnowledgeCommitResult & { removed: number }> {
  const removeItemIds = targets.map((target) => {
    return target.itemId
  })
  const fileIds = targets.flatMap((target) => {
    return target.fileId === null ? [] : [target.fileId]
  })

  try {
    const state = await commitKnowledgeProject(context, removeItemIds)

    context.logger.set({
      attributes: {
        knowledge: {
          operation: 'remove',
          removed: removeItemIds.length,
        },
      },
    })

    return { ...state, removed: removeItemIds.length }
  } finally {
    try {
      await restoreUnlinkedFileExpiry(context, fileIds)
    } catch (exception) {
      recordKnowledgeError(context.logger, 'restore-file-expiry', exception)
    }

    await invalidateStorageCache(context.userId, context.logger)
  }
}

/**
 * Finds the items of this project and user among the client's public ids,
 * optionally narrowed to one folder. Ids that are malformed, unknown, from
 * another project or outside the folder come back in `skipped` exactly as
 * sent; they are never an error and never touched.
 */
export async function findKnowledgeRemovalTargets(
  context: KnowledgeIngestContext,
  input: { remove: string[], folderId: string | null },
): Promise<{ targets: KnowledgeRemovalTarget[], skipped: string[] }> {
  const requested = [...new Set(input.remove)]
  const decodable = requested.filter((publicId) => {
    return decodeKnowledgeEntityId(publicId) !== null
  })
  const foundRows: KnowledgeItemRow[] = []

  for (const group of groupIds(decodable)) {
    const rows = await useDb()
      .select()
      .from(schema.projectKnowledgeItems)
      .where(and(
        inArray(schema.projectKnowledgeItems.id, group),
        eq(schema.projectKnowledgeItems.userId, context.userId),
        eq(schema.projectKnowledgeItems.projectId, context.projectId),
        input.folderId === null
          ? undefined
          : eq(schema.projectKnowledgeItems.folderId, input.folderId),
      ))

    foundRows.push(...rows)
  }

  const foundIds = new Set(foundRows.map((row) => {
    return row.id
  }))

  return {
    targets: foundRows.map((row) => {
      return {
        itemId: decodeKnowledgeEntityId(row.id)!,
        fileId: row.fileId,
      }
    }),
    skipped: requested.filter((publicId) => {
      return !foundIds.has(publicId)
    }),
  }
}

/**
 * Handles `POST commit`. When no id matches an item (an empty list, or ids
 * that are unknown, foreign or outside the folder) nothing changes, so there
 * is no version bump and no forced rebuild: the current state is returned,
 * after a lazy rebuild when the pack is stale (a client cannot churn builds
 * by repeating the call). Otherwise the matching items are removed and the
 * change is committed once; ids that do not match are reported in `skipped`.
 */
export async function commitKnowledgeRequest(
  context: KnowledgeIngestContext,
  input: { remove: string[], folderId: string | null },
): Promise<KnowledgeCommitResponse> {
  const { targets, skipped } = input.remove.length === 0
    ? { targets: [], skipped: [] }
    : await findKnowledgeRemovalTargets(context, input)

  if (targets.length === 0) {
    const state = await settleUnchangedCommit(context)

    context.logger.set({
      attributes: {
        knowledge: {
          operation: 'commit',
          noop: true,
          requested: input.remove.length,
          skipped: skipped.length,
        },
      },
    })

    return { ...state, removed: 0, skipped }
  }

  context.logger.set({
    attributes: {
      knowledge: {
        operation: 'commit',
        requested: input.remove.length,
        matched: targets.length,
        skipped: skipped.length,
        folderSync: input.folderId !== null,
      },
    },
  })

  const result = await removeKnowledgeItems(context, targets)

  return {
    version: result.version,
    packVersion: result.packVersion,
    removed: result.removed,
    skipped,
  }
}
