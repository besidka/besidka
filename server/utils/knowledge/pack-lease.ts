import type { LoggerLike } from '~~/server/utils/files/logger'
import type { ProjectMemoryLease } from '~~/server/utils/projects/memory-lease'
import { acquireMemoryLease } from '~~/server/utils/projects/memory-lease'

export function knowledgePackBuildLeaseKey(projectId: number): string {
  return `knowledge-pack-build:${projectId}`
}

/**
 * Takes the per-project pack build lease: the generic 120 s KV lease with a
 * 30 s heartbeat, under `knowledge-pack-build:<projectId>`. Returns null when
 * another live build holds it. The caller must `release()` it in a `finally`.
 */
export async function acquireKnowledgePackLease(
  projectId: number,
  logger?: LoggerLike,
): Promise<ProjectMemoryLease | null> {
  return await acquireMemoryLease(
    knowledgePackBuildLeaseKey(projectId),
    logger
      ? {
        set: (data) => {
          logger.set(data)
        },
      }
      : undefined,
  )
}
