import type { JobRunner } from '~~/server/utils/platform/types'
import { createError } from 'evlog'

export const JOB_RUNNER_NOT_CONFIGURED = 'job_runner_not_configured'

function throwNotConfigured(): never {
  throw createError({
    message: 'Background jobs are not available',
    status: 501,
    why: JOB_RUNNER_NOT_CONFIGURED,
  })
}

/**
 * Placeholder until R-1 and R-5 add the orchestrator Workflow Worker. Every
 * method answers 501, so a capability that needs jobs fails loudly instead
 * of running work inline.
 */
export function createCloudflareJobRunner(): JobRunner {
  return {
    async enqueue() {
      throwNotConfigured()
    },
    async get() {
      throwNotConfigured()
    },
    async cancel() {
      throwNotConfigured()
    },
    async step() {
      throwNotConfigured()
    },
  }
}
