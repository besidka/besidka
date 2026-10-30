import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { getEffectiveRetentionDays } from '~~/server/utils/files/file-governance'
import {
  decodeKnowledgeProjectId,
  unlinkKnowledgeProjectFiles,
} from '~~/server/utils/knowledge/linked-files'
import { purgeProjectKnowledgeForProject } from '~~/server/utils/knowledge/purge'

type DbClient = ReturnType<typeof useDb>

function createProjectNotFoundError() {
  return createError({
    message: 'Project not found',
    status: 404,
  })
}

/**
 * Renames an owned project. The name is expected to be trimmed and checked
 * by the caller. Another user's project reads as not found.
 */
export async function renameProject(
  db: DbClient,
  userId: number,
  projectId: string,
  name: string,
) {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true },
  })

  if (!project) {
    throw createProjectNotFoundError()
  }

  await db.update(schema.projects)
    .set({ name, updatedAt: new Date() })
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return { name }
}

/**
 * Pins or unpins an owned project. Without `pinned` the current state is
 * flipped (the web action); with it the state is set, so repeating the call
 * changes nothing.
 */
export async function setProjectPinned(
  db: DbClient,
  userId: number,
  projectId: string,
  pinned?: boolean,
) {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true, pinnedAt: true },
  })

  if (!project) {
    throw createProjectNotFoundError()
  }

  const shouldPin = pinned ?? !project.pinnedAt

  if (pinned !== undefined && shouldPin === Boolean(project.pinnedAt)) {
    return { pinnedAt: project.pinnedAt }
  }

  const pinnedAt = shouldPin ? new Date() : null

  await db.update(schema.projects)
    .set({ pinnedAt, updatedAt: new Date() })
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return { pinnedAt }
}

/**
 * Archives or restores an owned project. Without `archived` the current
 * state is flipped (the web action); with it the state is set.
 */
export async function setProjectArchived(
  db: DbClient,
  userId: number,
  projectId: string,
  archived?: boolean,
) {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true, archivedAt: true },
  })

  if (!project) {
    throw createProjectNotFoundError()
  }

  const shouldArchive = archived ?? !project.archivedAt

  if (archived !== undefined && shouldArchive === Boolean(project.archivedAt)) {
    return { archivedAt: project.archivedAt }
  }

  const archivedAt = shouldArchive ? new Date() : null

  await db.update(schema.projects)
    .set({ archivedAt, updatedAt: new Date() })
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return { archivedAt }
}

/**
 * Deletes an owned project. Its chats are kept and detached, the linked
 * library files get their retention expiry back, the row goes (cascading
 * knowledge items and project memory), the knowledge objects in R2 are
 * purged on a best-effort basis and the storage cache is invalidated.
 * Returns how many chats were detached.
 */
export async function deleteProject(
  db: DbClient,
  userId: number,
  projectId: string,
  logger: LoggerLike,
) {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true },
  })
  const internalProjectId = project
    ? decodeKnowledgeProjectId(project.id)
    : null

  if (!project || internalProjectId === null) {
    throw createProjectNotFoundError()
  }

  const detachedChats = await db.update(schema.chats)
    .set({
      projectId: sql`NULL`,
      activityAt: new Date(),
    })
    .where(and(
      eq(schema.chats.projectId, project.id),
      eq(schema.chats.userId, userId),
    ))
    .returning({ id: schema.chats.id })
  const retentionDays = await getEffectiveRetentionDays(userId)

  await unlinkKnowledgeProjectFiles({
    userId,
    projectId: internalProjectId,
    retentionDays,
  })

  await db.delete(schema.projects)
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  try {
    const purgeResult = await purgeProjectKnowledgeForProject(
      userId,
      internalProjectId,
    )

    logger.set({
      attributes: {
        knowledgePurge: {
          objectsDeleted: purgeResult.objectsDeleted,
          batches: purgeResult.batches,
        },
      },
    })
  } catch (exception) {
    logger.set({
      attributes: {
        knowledgePurge: {
          failed: true,
          error: exceptionMessage(exception),
        },
      },
    })
  }

  await invalidateStorageCache(userId, logger)

  return { chatsDetached: detachedChats.length }
}
