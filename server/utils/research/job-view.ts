import type { ResearchJobView } from '#shared/types/research.d'
import * as schema from '~~/server/db/schema'

export function toResearchJobView(
  job: typeof schema.researchJobs.$inferSelect,
): ResearchJobView {
  return {
    publicId: job.id,
    status: job.status,
    provider: job.provider,
    level: job.level,
    modelId: job.modelId,
    startedAt: job.startedAt ? job.startedAt.getTime() : null,
    error: job.error,
    resultMessageId: job.resultMessageId,
    answers: job.answers ?? null,
  }
}
