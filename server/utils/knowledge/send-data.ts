import { and, asc, eq } from 'drizzle-orm'
import type {
  KnowledgeItem,
  KnowledgeMode,
  KnowledgePackHeader,
  KnowledgePackLine,
} from '#shared/types/project-knowledge.d'
import * as schema from '~~/server/db/schema'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { toKnowledgeItemWire } from '~~/server/utils/knowledge/items'
import { readKnowledgePack } from '~~/server/utils/knowledge/pack'

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

    memoized = readKnowledgePack({
      userId: input.userId,
      projectId: input.projectId,
      version: input.packVersion,
    }).catch((exception: unknown) => {
      input.logger?.set({
        attributes: { knowledge: { error: exceptionMessage(exception) } },
      })

      return null
    })

    return memoized
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
    items: rows.map((row) => {
      return { ...toKnowledgeItemWire(row.item), storageKey: row.storageKey }
    }),
    loadPack: createPackLoader({
      userId: input.userId,
      projectId: input.projectId,
      packVersion: project.packVersion,
      logger: input.logger,
    }),
  }
}

/**
 * The only K2 module that reads knowledge items and state from D1. The cheap
 * items query runs first and returns null for a project without items, so a
 * project that never used knowledge costs one D1 read and no R2 call. The
 * pack is fetched only when `loadPack()` is called, once per call of this
 * function, through `readKnowledgePack` (which owns every size, line and
 * version check and resolves to null instead of throwing). A D1 failure
 * resolves to null with a message-only log entry, so knowledge never fails a
 * send.
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
