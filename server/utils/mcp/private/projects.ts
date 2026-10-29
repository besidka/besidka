import { and, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { createError } from 'evlog'
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import {
  knowledgeItemsBatchCreateSchema,
  knowledgeNoteCreateSchema,
} from '#shared/utils/project-knowledge-schemas'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'
import {
  createKnowledgeNote,
  hashKnowledgeText,
  ingestKnowledgeItems,
} from '~~/server/utils/knowledge/ingest'
import { listKnowledgeItems } from '~~/server/utils/knowledge/items'
import { enforceKnowledgeWriteRateLimit } from '~~/server/utils/knowledge/rate-limit'
import { getKnowledgeItemText } from '~~/server/utils/knowledge/text-store'
import {
  clampMcpLimit,
} from '~~/server/utils/mcp/private/chats'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'
import {
  createProjectsCursor,
  parseProjectsCursor,
} from '~~/server/utils/projects/cursor'

type DbClient = ReturnType<typeof useDb>

export const MCP_PROJECT_LIST_DEFAULT_LIMIT = 20
export const MCP_PROJECT_LIST_MAX_LIMIT = 50
export const MCP_PROJECT_INSTRUCTIONS_MAX_CHARS = 10_000
export const MCP_KNOWLEDGE_READ_DEFAULT_CHARS = 50_000
export const MCP_KNOWLEDGE_READ_MAX_CHARS = 100_000
export const MCP_KNOWLEDGE_TEXT_MAX_CHARS = 200_000

const TEXT_MEDIA_TYPE = 'text/plain'
const MARKDOWN_MEDIA_TYPE = 'text/markdown'
const MARKDOWN_EXTENSION = /\.(md|markdown)$/i

export interface McpOwnedProject {
  projectId: number
  projectPublicId: string
}

export interface McpKnowledgeItemSummary {
  id: string
  kind: KnowledgeItem['kind']
  title: string
  description: string | null
  path: string | null
  mediaType: string | null
  textBytes: number
  sizeBytes: number | null
  status: KnowledgeItem['extractStatus']
  flagged: boolean
  pinned: boolean
  updatedAt: string
}

function createProjectNotFoundError(projectId: string) {
  return createError({
    status: 404,
    message: `No project with the id "${projectId}". Call list_projects `
      + 'to find one.',
  })
}

function createItemNotFoundError(itemId: string) {
  return createError({
    status: 404,
    message: `No knowledge item with the id "${itemId}" in this project. `
      + 'Call get_project to list the items.',
  })
}

function createInvalidInputError(message: string) {
  return createError({ status: 400, message })
}

export async function resolveMcpOwnedProject(
  db: DbClient,
  userId: number,
  projectPublicId: string,
): Promise<McpOwnedProject> {
  const projectId = decodeKnowledgeEntityId(projectPublicId)

  if (projectId === null) {
    throw createProjectNotFoundError(projectPublicId)
  }

  const project = await db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, projectPublicId),
      eq(schema.projects.userId, userId),
    ))
    .get()

  if (!project) {
    throw createProjectNotFoundError(projectPublicId)
  }

  return { projectId, projectPublicId }
}

export function toMcpKnowledgeItemSummary(
  item: KnowledgeItem,
): McpKnowledgeItemSummary {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    path: item.relativePath,
    mediaType: item.mediaType,
    textBytes: item.textBytes,
    sizeBytes: item.sizeBytes,
    status: item.extractStatus,
    flagged: item.extractStatus === 'flagged',
    pinned: item.pinned,
    updatedAt: item.updatedAt,
  }
}

export async function listMcpProjects(
  db: DbClient,
  userId: number,
  input: {
    cursor?: string
    limit?: number
    search?: string
    archived?: boolean
  },
) {
  const limit = clampMcpLimit(
    input.limit,
    MCP_PROJECT_LIST_DEFAULT_LIMIT,
    MCP_PROJECT_LIST_MAX_LIMIT,
  )
  const search = input.search?.trim() ?? ''
  const cursor = parseProjectsCursor(input.cursor, 'activity')
  const cursorFilter = cursor?.sortBy === 'activity'
    ? or(
      lt(schema.projects.activityAt, cursor.activityAt),
      and(
        eq(schema.projects.activityAt, cursor.activityAt),
        lt(schema.projects.id, cursor.id),
      ),
    )
    : undefined
  const rows = await db.select({
    id: schema.projects.id,
    name: schema.projects.name,
    instructions: schema.projects.instructions,
    knowledgeMode: schema.projects.knowledgeMode,
    pinnedAt: schema.projects.pinnedAt,
    archivedAt: schema.projects.archivedAt,
    activityAt: schema.projects.activityAt,
  })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      input.archived
        ? isNotNull(schema.projects.archivedAt)
        : isNull(schema.projects.archivedAt),
      search ? containsLikeEscaped(schema.projects.name, search) : undefined,
      cursorFilter,
    ))
    .orderBy(desc(schema.projects.activityAt), desc(schema.projects.id))
    .limit(limit)
  const lastRow = rows[rows.length - 1]

  return {
    projects: rows.map((row) => {
      return {
        id: row.id,
        name: row.name,
        hasInstructions: Boolean(row.instructions),
        knowledgeMode: row.knowledgeMode ?? 'auto',
        pinned: row.pinnedAt !== null,
        archived: row.archivedAt !== null,
        activityAt: toIsoTimestamp(row.activityAt),
      }
    }),
    nextCursor: rows.length === limit && lastRow
      ? createProjectsCursor(lastRow, 'activity')
      : null,
  }
}

export async function getMcpProject(
  db: DbClient,
  userId: number,
  projectPublicId: string,
) {
  const { projectId } = await resolveMcpOwnedProject(
    db,
    userId,
    projectPublicId,
  )
  const project = await db.select({
    id: schema.projects.id,
    name: schema.projects.name,
    instructions: schema.projects.instructions,
    knowledgeMode: schema.projects.knowledgeMode,
    archivedAt: schema.projects.archivedAt,
    activityAt: schema.projects.activityAt,
  })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, projectPublicId),
      eq(schema.projects.userId, userId),
    ))
    .get()

  if (!project) {
    throw createProjectNotFoundError(projectPublicId)
  }

  const items = await listKnowledgeItems({ userId, projectId })

  return {
    id: project.id,
    name: project.name,
    instructions: project.instructions ?? null,
    knowledgeMode: project.knowledgeMode ?? 'auto',
    archived: project.archivedAt !== null,
    activityAt: toIsoTimestamp(project.activityAt),
    knowledge: items.map(toMcpKnowledgeItemSummary),
  }
}

export function sliceMcpKnowledgeText(
  text: string,
  offset: number,
  maxChars: number,
) {
  const start = Math.min(Math.max(0, Math.trunc(offset)), text.length)
  const end = Math.min(text.length, start + maxChars)

  return {
    text: text.slice(start, end),
    offset: start,
    totalChars: text.length,
    nextOffset: end < text.length ? end : null,
  }
}

export async function readMcpKnowledgeItem(
  db: DbClient,
  userId: number,
  input: {
    projectId: string
    itemId: string
    offset?: number
    maxChars?: number
  },
) {
  const { projectId } = await resolveMcpOwnedProject(
    db,
    userId,
    input.projectId,
  )
  const itemId = decodeKnowledgeEntityId(input.itemId)

  if (itemId === null) {
    throw createItemNotFoundError(input.itemId)
  }

  const item = await db.select({
    id: schema.projectKnowledgeItems.id,
    title: schema.projectKnowledgeItems.title,
    extractStatus: schema.projectKnowledgeItems.extractStatus,
  })
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.id, input.itemId),
      eq(schema.projectKnowledgeItems.userId, userId),
      eq(schema.projectKnowledgeItems.projectId, projectId),
    ))
    .get()

  if (!item) {
    throw createItemNotFoundError(input.itemId)
  }

  const text = await getKnowledgeItemText({ userId, projectId, itemId })
  const maxChars = clampMcpLimit(
    input.maxChars,
    MCP_KNOWLEDGE_READ_DEFAULT_CHARS,
    MCP_KNOWLEDGE_READ_MAX_CHARS,
  )

  return {
    id: item.id,
    title: item.title,
    status: item.extractStatus,
    flagged: item.extractStatus === 'flagged',
    ...sliceMcpKnowledgeText(text ?? '', input.offset ?? 0, maxChars),
  }
}

export async function updateMcpProjectInstructions(
  db: DbClient,
  userId: number,
  input: { projectId: string, instructions: string | null },
) {
  await resolveMcpOwnedProject(db, userId, input.projectId)

  const instructions = input.instructions?.trim() || null

  if (
    instructions !== null
    && instructions.length > MCP_PROJECT_INSTRUCTIONS_MAX_CHARS
  ) {
    throw createInvalidInputError(
      `Instructions must be at most ${MCP_PROJECT_INSTRUCTIONS_MAX_CHARS} `
      + 'characters.',
    )
  }

  await db.update(schema.projects)
    .set({ instructions, updatedAt: new Date() })
    .where(and(
      eq(schema.projects.id, input.projectId),
      eq(schema.projects.userId, userId),
    ))

  return { projectId: input.projectId, instructions }
}

export async function addMcpProjectNote(
  db: DbClient,
  userId: number,
  input: {
    projectId: string
    title: string
    body: string
    description?: string | null
  },
  logger: LoggerLike,
) {
  const { projectId } = await resolveMcpOwnedProject(
    db,
    userId,
    input.projectId,
  )
  const parsed = knowledgeNoteCreateSchema.safeParse({
    title: input.title,
    body: input.body,
    description: input.description ?? undefined,
  })

  if (!parsed.success) {
    throw createInvalidInputError(
      `Invalid note: ${parsed.error.issues[0]?.message ?? 'check the fields'}`,
    )
  }

  await enforceKnowledgeWriteRateLimit(userId)

  const note = await createKnowledgeNote(
    { userId, projectId, logger },
    parsed.data,
  )

  return toMcpKnowledgeItemSummary(note)
}

export function resolveMcpTextMediaType(name: string): string {
  return MARKDOWN_EXTENSION.test(name.trim())
    ? MARKDOWN_MEDIA_TYPE
    : TEXT_MEDIA_TYPE
}

export async function addMcpProjectText(
  db: DbClient,
  userId: number,
  input: { projectId: string, name: string, text: string },
  logger: LoggerLike,
) {
  const { projectId } = await resolveMcpOwnedProject(
    db,
    userId,
    input.projectId,
  )

  if (input.text.trim().length === 0) {
    throw createInvalidInputError('The text is empty.')
  }

  const parsed = knowledgeItemsBatchCreateSchema.safeParse({
    items: [{
      title: input.name,
      mediaType: resolveMcpTextMediaType(input.name),
      extractor: 'text',
      extractStatus: 'ready',
      contentHash: await hashKnowledgeText(input.text),
      text: input.text,
    }],
    commit: true,
  })

  if (!parsed.success) {
    throw createInvalidInputError(
      `Invalid text item: ${parsed.error.issues[0]?.message ?? 'check the fields'}`,
    )
  }

  await enforceKnowledgeWriteRateLimit(userId)

  const result = await ingestKnowledgeItems(
    { userId, projectId, logger },
    parsed.data,
  )
  const [item] = result.items

  if (!item) {
    throw createError({
      status: 409,
      message: 'This project already has an item with the same text.',
    })
  }

  return toMcpKnowledgeItemSummary(item)
}
