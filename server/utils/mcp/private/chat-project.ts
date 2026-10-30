import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'

type DbClient = ReturnType<typeof useDb>

export interface McpChatProject {
  id: string
  name: string
}

function createProjectNotFoundError(projectId: string) {
  return createError({
    status: 404,
    message: `No project with the id "${projectId}". Call list_projects `
      + 'to find one.',
  })
}

/**
 * Resolves a project id given to a chat tool. A malformed id and another
 * user's project are both the same not-found, so ids cannot be probed.
 */
export async function resolveMcpChatProject(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<McpChatProject> {
  if (decodeKnowledgeEntityId(projectId) === null) {
    throw createProjectNotFoundError(projectId)
  }

  const project = await db.select({
    id: schema.projects.id,
    name: schema.projects.name,
  })
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
    ))
    .get()

  if (!project) {
    throw createProjectNotFoundError(projectId)
  }

  return project
}
