import type { UIMessage } from 'ai'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import { and, eq, ne } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { keyProviderIdForGateway } from '~~/server/utils/gateways/index'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'
import {
  isProjectMemoryLeaseHeld,
  noopProjectMemoryLogger,
} from '~~/server/utils/projects/memory-lease'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'

const TRUNCATION_ELLIPSIS = '\u2026'

type DbClient = ReturnType<typeof useDb>

export function getMemoryProviderId(selection: ResolvedMemoryModel) {
  if (selection.gatewayId) {
    return keyProviderIdForGateway(selection.gatewayId)
  }

  return selection.providerId
}

export async function markProjectsMemoryStale(
  projectIds: Array<string | null | undefined>,
  userId: number,
  db: DbClient = useDb(),
) {
  const uniqueProjectIds = [...new Set(projectIds)].filter(
    (projectId): projectId is string => {
      return projectId !== null && projectId !== undefined
    },
  )

  if (!uniqueProjectIds.length) {
    return
  }

  const memoryDirtyAt = new Date()

  for (const projectId of uniqueProjectIds) {
    await db.update(schema.projects)
      .set({
        memoryStatus: 'stale',
        memoryDirtyAt,
        memoryError: null,
      })
      .where(and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        ne(schema.projects.memoryStatus, 'disabled'),
      ))
  }
}

/**
 * Reports `stale` instead of a `refreshing` row whose lease is gone: a
 * killed Worker never writes its final status, so without this the project
 * page would poll a dead refresh forever. Read-only; the row is not touched.
 */
export async function resolveProjectMemoryDisplayStatus(
  status: ProjectMemoryStatus,
  projectId: string,
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
): Promise<ProjectMemoryStatus> {
  if (status !== 'refreshing') {
    return status
  }

  const isLeaseHeld = await isProjectMemoryLeaseHeld(projectId, logger)

  return isLeaseHeld ? status : 'stale'
}

export function projectMemoryMessageText(parts: UIMessage['parts']) {
  if (!Array.isArray(parts)) {
    return ''
  }

  const values: string[] = []

  for (const part of parts) {
    if (part.type !== 'text' || !part.text?.trim()) {
      continue
    }

    values.push(part.text.trim())
  }

  return values.join('\n')
}

export function truncateProjectMemoryText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars - 1).trimEnd()}${TRUNCATION_ELLIPSIS}`
}
