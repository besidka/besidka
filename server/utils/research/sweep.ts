import type { VapidKeys } from '~~/server/utils/push'
import { finalizeResearchJob } from '~~/server/utils/research/finalize'

export interface SweepResearchJobsInput {
  batchSize: number
  maxRuntimeMs: number
  vapid: VapidKeys
  waitUntil?: (promise: Promise<unknown>) => void
  logger?: { set: (fields: Record<string, unknown>) => void }
}

export interface SweepResearchJobsResult {
  selectedCount: number
  finalizedCount: number
  stillRunningCount: number
  failedCount: number
  erroredCount: number
  runtimeMs: number
}

export async function sweepResearchJobs(
  input: SweepResearchJobsInput,
): Promise<SweepResearchJobsResult> {
  const logger = input.logger
  const db = useDb()
  const startedAt = Date.now()
  const jobs = await db.query.researchJobs.findMany({
    where: {
      status: { in: ['pending', 'running'] },
    },
    orderBy: { updatedAt: 'asc' },
    limit: Math.max(input.batchSize, 1),
  })

  let finalizedCount = 0
  let stillRunningCount = 0
  let failedCount = 0
  let erroredCount = 0

  for (const job of jobs) {
    const runtimeMs = Date.now() - startedAt

    if (runtimeMs >= input.maxRuntimeMs) {
      break
    }

    try {
      const outcome = await finalizeResearchJob({
        db,
        job,
        vapid: input.vapid,
        waitUntil: input.waitUntil,
        logger: logger ?? { set: () => undefined },
      })

      if (outcome === 'finalized') {
        finalizedCount += 1
      } else if (outcome === 'still-running') {
        stillRunningCount += 1
      } else if (outcome === 'failed') {
        failedCount += 1
      }
    } catch (exception) {
      erroredCount += 1
      logger?.set({
        researchSweep: {
          phase: 'finalize',
          jobId: job.id,
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })
    }
  }

  return {
    selectedCount: jobs.length,
    finalizedCount,
    stillRunningCount,
    failedCount,
    erroredCount,
    runtimeMs: Date.now() - startedAt,
  }
}
