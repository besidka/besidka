import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import type { RequestEvent } from 'nuxt/server'
import * as schema from '~~/server/db/schema'
import {
  decodePublicId,
  encodePublicId,
} from '~~/server/utils/custom-db-types'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import type { KnowledgeItemRow } from '~~/server/utils/knowledge/items'

export interface KnowledgeProjectAccess {
  userId: number
  projectId: number
  projectPublicId: string
}

export interface KnowledgeItemAccess extends KnowledgeProjectAccess {
  itemId: number
  item: KnowledgeItemRow
}

/**
 * Decodes a client-supplied public id into the internal integer id. Returns
 * null for anything that is not the canonical encoding of a positive safe
 * integer (foreign characters, a non-canonical alias, NaN), so a malformed id
 * is a not-found and never reaches a typed query, which would decode it again
 * and could throw mid-statement.
 */
export function decodeKnowledgeEntityId(publicId: unknown): number | null {
  if (typeof publicId !== 'string' || publicId.length === 0) {
    return null
  }

  try {
    const internalId = decodePublicId(publicId)

    if (!Number.isSafeInteger(internalId) || internalId <= 0) {
      return null
    }

    return encodePublicId(internalId) === publicId ? internalId : null
  } catch (_exception) {
    return null
  }
}

function createProjectNotFoundError() {
  return createError({
    message: 'Project not found',
    status: 404,
    why: 'The project does not exist or belongs to another account',
    fix: 'Open a project from your project list',
  })
}

function createItemNotFoundError() {
  return createError({
    message: 'Knowledge item not found',
    status: 404,
    why: 'The item does not exist in this project',
    fix: 'Refresh the project knowledge list',
  })
}

function readRouteParam(event: RequestEvent, name: string): string {
  const value = getDecodedRouterParams(event)[name]

  return typeof value === 'string' ? value : ''
}

/**
 * Resolves the session user and the project from the route, in that order.
 * An unauthenticated request is a 401, and a missing, malformed or foreign
 * project is a 404 before any caller touches the database or R2. The
 * returned `projectId` is the internal integer id used for R2 keys and raw
 * SQL; `projectPublicId` is the id for typed queries and the wire.
 */
export async function resolveKnowledgeProject(
  event: RequestEvent,
): Promise<KnowledgeProjectAccess> {
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const projectPublicId = readRouteParam(event, 'id')
  const projectId = decodeKnowledgeEntityId(projectPublicId)

  if (projectId === null) {
    throw createProjectNotFoundError()
  }

  const project = await useDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, projectPublicId),
      eq(schema.projects.userId, userId),
    ))
    .get()

  if (!project) {
    throw createProjectNotFoundError()
  }

  return { userId, projectId, projectPublicId }
}

/**
 * Resolves the project (see `resolveKnowledgeProject`) and then the item in
 * the `itemId` route parameter, matched on user and project in the same
 * `WHERE`. An item of another project or account is a 404.
 */
export async function resolveKnowledgeItem(
  event: RequestEvent,
): Promise<KnowledgeItemAccess> {
  const access = await resolveKnowledgeProject(event)
  const itemPublicId = readRouteParam(event, 'itemId')
  const itemId = decodeKnowledgeEntityId(itemPublicId)

  if (itemId === null) {
    throw createItemNotFoundError()
  }

  const item = await useDb()
    .select()
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.id, itemPublicId),
      eq(schema.projectKnowledgeItems.userId, access.userId),
      eq(schema.projectKnowledgeItems.projectId, access.projectId),
    ))
    .get()

  if (!item) {
    throw createItemNotFoundError()
  }

  return { ...access, itemId, item }
}
