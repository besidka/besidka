import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  finalizeResearchJob: vi.fn(),
}))

vi.mock('~~/server/utils/research/finalize', () => ({
  finalizeResearchJob: mocks.finalizeResearchJob,
}))

async function importSweep() {
  return import('../../../../server/utils/research/sweep')
}

function createDb(jobs: Array<{ id: string }>) {
  return {
    query: {
      researchJobs: {
        findMany: vi.fn(async () => jobs),
      },
    },
  }
}

describe('sweepResearchJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finalizes every selected pending/running job sequentially', async () => {
    mocks.finalizeResearchJob
      .mockResolvedValueOnce('finalized')
      .mockResolvedValueOnce('still-running')
      .mockResolvedValueOnce('failed')

    const jobs = [{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }]
    const db = createDb(jobs)

    vi.stubGlobal('useDb', () => db)

    const result = await importSweep().then(({ sweepResearchJobs }) => (
      sweepResearchJobs({
        batchSize: 20,
        maxRuntimeMs: 20000,
        vapid: {},
      })
    ))

    expect(db.query.researchJobs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['pending', 'running'] } },
        orderBy: { createdAt: 'asc' },
        limit: 20,
      }),
    )
    expect(mocks.finalizeResearchJob).toHaveBeenCalledTimes(3)
    expect(result).toEqual(expect.objectContaining({
      selectedCount: 3,
      finalizedCount: 1,
      stillRunningCount: 1,
      failedCount: 1,
      erroredCount: 0,
    }))
  })

  it('counts a thrown finalize call as errored and continues the batch', async () => {
    mocks.finalizeResearchJob
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('finalized')

    const jobs = [{ id: 'job-1' }, { id: 'job-2' }]
    const db = createDb(jobs)
    const logger = { set: vi.fn() }

    vi.stubGlobal('useDb', () => db)

    const { sweepResearchJobs } = await importSweep()
    const result = await sweepResearchJobs({
      batchSize: 20,
      maxRuntimeMs: 20000,
      vapid: {},
      logger,
    })

    expect(result.erroredCount).toBe(1)
    expect(result.finalizedCount).toBe(1)
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      researchSweep: expect.objectContaining({
        jobId: 'job-1',
        error: 'boom',
      }),
    }))
  })

  it('stops processing once the max runtime budget is exceeded', async () => {
    mocks.finalizeResearchJob.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))

      return 'still-running'
    })

    const jobs = [{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }]
    const db = createDb(jobs)

    vi.stubGlobal('useDb', () => db)

    const { sweepResearchJobs } = await importSweep()
    const result = await sweepResearchJobs({
      batchSize: 20,
      maxRuntimeMs: 40,
      vapid: {},
    })

    expect(mocks.finalizeResearchJob).toHaveBeenCalledTimes(2)
    expect(result.selectedCount).toBe(3)
  })
})
