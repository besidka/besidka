import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { ProjectMemoryLease } from '~~/server/utils/projects/memory-lease'
import { acquireMemoryLease } from '~~/server/utils/projects/memory-lease'

const BACKOFF_FAILURE_THRESHOLD = 3
const BACKOFF_TTL_SECONDS = 600
const LAZY_BUILD_MIN_INTERVAL_MS = 30_000
const KV_MIN_EXPIRATION_SECONDS = 60

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

interface KnowledgePackBackoff {
  count: number
  version: number
}

function isBackoffRecord(value: unknown): value is KnowledgePackBackoff {
  return typeof value === 'object'
    && value !== null
    && Number.isSafeInteger((value as KnowledgePackBackoff).count)
    && Number.isSafeInteger((value as KnowledgePackBackoff).version)
}

function logBackoffError(
  logger: LoggerLike | undefined,
  operation: string,
  exception: unknown,
): void {
  try {
    logger?.set({
      attributes: {
        knowledgePack: {
          backoff: { operation, error: exceptionMessage(exception) },
        },
      },
    })
  } catch (_loggingException) {
    return
  }
}

async function readBackoffRecord(
  projectId: number,
): Promise<KnowledgePackBackoff | null> {
  const stored = await useKV().get(knowledgePackBackoffKey(projectId))

  if (!stored) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(stored)

    return isBackoffRecord(parsed) ? parsed : null
  } catch (_exception) {
    return null
  }
}

export function knowledgePackBackoffKey(projectId: number): string {
  return `knowledge-pack-backoff:${projectId}`
}

/**
 * True while lazy rebuilds for this project and `knowledge_version` are
 * paused: three or more consecutive failures were recorded within the last
 * ten minutes. A record for another version does not count. KV errors fail
 * open (the build is allowed).
 */
export async function isKnowledgePackBackedOff(
  projectId: number,
  version: number,
  logger?: LoggerLike,
): Promise<boolean> {
  try {
    const record = await readBackoffRecord(projectId)

    return record !== null
      && record.version === version
      && record.count >= BACKOFF_FAILURE_THRESHOLD
  } catch (exception) {
    logBackoffError(logger, 'read', exception)

    return false
  }
}

/**
 * Counts one failed or refused build for the version. The counter restarts
 * at 1 when the stored record is for another version, and the record
 * expires ten minutes after the last failure. Never throws.
 */
export async function recordKnowledgePackFailure(
  projectId: number,
  version: number,
  logger?: LoggerLike,
): Promise<void> {
  try {
    const record = await readBackoffRecord(projectId)
    const count = record && record.version === version ? record.count + 1 : 1

    await useKV().put(
      knowledgePackBackoffKey(projectId),
      JSON.stringify({ count, version }),
      { expirationTtl: BACKOFF_TTL_SECONDS },
    )
  } catch (exception) {
    logBackoffError(logger, 'record', exception)
  }
}

/**
 * Forgets the failure counter after a finished build. Never throws.
 */
export async function clearKnowledgePackBackoff(
  projectId: number,
  logger?: LoggerLike,
): Promise<void> {
  try {
    await useKV().delete(knowledgePackBackoffKey(projectId))
  } catch (exception) {
    logBackoffError(logger, 'clear', exception)
  }
}

export function knowledgePackBuiltKey(projectId: number): string {
  return `knowledge-pack-built:${projectId}`
}

/**
 * True when a pack build for this project finished less than 30 seconds ago,
 * so the lazy rebuild path (panel loads, sends) waits instead of building
 * once per insert batch of a running upload. The marker holds the finish
 * time because KV cannot expire a key sooner than 60 seconds. Explicit
 * commits never read it. KV errors and unreadable values fail open.
 */
export async function isKnowledgePackRecentlyBuilt(
  projectId: number,
  logger?: LoggerLike,
): Promise<boolean> {
  try {
    const stored = await useKV().get(knowledgePackBuiltKey(projectId))
    const builtAt = Number(stored)

    if (!stored || !Number.isFinite(builtAt)) {
      return false
    }

    const elapsedMs = Date.now() - builtAt

    return elapsedMs >= 0 && elapsedMs < LAZY_BUILD_MIN_INTERVAL_MS
  } catch (exception) {
    logBackoffError(logger, 'read-built', exception)

    return false
  }
}

/**
 * Stamps the finish time of a successful build. Never throws.
 */
export async function recordKnowledgePackBuilt(
  projectId: number,
  logger?: LoggerLike,
): Promise<void> {
  try {
    await useKV().put(
      knowledgePackBuiltKey(projectId),
      String(Date.now()),
      { expirationTtl: KV_MIN_EXPIRATION_SECONDS },
    )
  } catch (exception) {
    logBackoffError(logger, 'record-built', exception)
  }
}
