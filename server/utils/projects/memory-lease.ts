import type { RequestLogger } from 'evlog'
import {
  putGenerationGuard,
  startGenerationGuardHeartbeat,
} from '~~/server/utils/ai/generation-guard'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export type ProjectMemoryLogger = Pick<RequestLogger, 'set'>

export interface ProjectMemoryLease {
  release: () => Promise<void>
}

export const noopProjectMemoryLogger: ProjectMemoryLogger = {
  set: () => {},
}

export function projectMemoryRefreshKvKey(projectId: string) {
  return `project-memory-refreshing:${projectId}`
}

/**
 * Reports whether a live refresh holds the lease. Fails open: when the lease
 * cannot be read it is treated as held, so a KV outage never relabels a
 * running refresh as stale.
 */
export async function isProjectMemoryLeaseHeld(
  projectId: string,
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
): Promise<boolean> {
  try {
    const heldLease = await useKV().get(projectMemoryRefreshKvKey(projectId))

    return !!heldLease
  } catch (exception) {
    logger.set({
      attributes: {
        projectMemoryLease: {
          operation: 'get',
          error: exceptionMessage(exception),
        },
      },
    })

    return true
  }
}

/**
 * Takes the per-project refresh lease: a short KV flag renewed by a heartbeat
 * for exactly as long as this invocation is alive, so a dead Worker stops
 * blocking refreshes after the lease expires. Returns null when another
 * live refresh already holds it. KV read failures fail open.
 */
export async function acquireProjectMemoryLease(
  projectId: string,
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
): Promise<ProjectMemoryLease | null> {
  const kv = useKV()
  const key = projectMemoryRefreshKvKey(projectId)

  try {
    const heldLease = await kv.get(key)

    if (heldLease) {
      return null
    }
  } catch (exception) {
    logger.set({
      attributes: {
        projectMemoryLease: {
          operation: 'get',
          error: exceptionMessage(exception),
        },
      },
    })
  }

  await putGenerationGuard(kv, key, 'put', logger)

  const heartbeat = startGenerationGuardHeartbeat(kv, key, logger)

  async function release() {
    await heartbeat.stop()

    try {
      await kv.delete(key)
    } catch (exception) {
      logger.set({
        attributes: {
          projectMemoryLease: {
            operation: 'delete',
            error: exceptionMessage(exception),
          },
        },
      })
    }

    logger.set({
      attributes: {
        projectMemoryLease: {
          operation: 'release',
          heartbeats: heartbeat.getRenewalCount(),
        },
      },
    })
  }

  return { release }
}
