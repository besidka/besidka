import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SweepLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

describe('research job sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  it('does nothing when the sweep is disabled', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as SweepLogger)
    const runSweep = vi.fn()
    const { runResearchJobSweepJob } = await import(
      '../../../server/plugins/research-job-sweep'
    )

    await runResearchJobSweepJob({
      controller: { cron: '*/5 * * * *', scheduledTime: 1771426560000 },
      config: {
        researchSweepEnabled: false,
        researchSweepBatchSize: 20,
        researchSweepMaxRuntimeMs: 20000,
      },
      vapid: {},
      createLogger,
      runSweep,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('emits success event with sweep metrics', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as SweepLogger)
    const runSweep = vi.fn().mockResolvedValue({
      selectedCount: 3,
      finalizedCount: 1,
      stillRunningCount: 1,
      failedCount: 1,
      erroredCount: 0,
      runtimeMs: 120,
    })
    const { runResearchJobSweepJob } = await import(
      '../../../server/plugins/research-job-sweep'
    )

    await runResearchJobSweepJob({
      controller: { cron: '*/5 * * * *', scheduledTime: 1771426560000 },
      config: {
        researchSweepEnabled: true,
        researchSweepBatchSize: 20,
        researchSweepMaxRuntimeMs: 20000,
      },
      vapid: {},
      createLogger,
      runSweep,
    })

    expect(runSweep).toHaveBeenCalledWith({
      batchSize: 20,
      maxRuntimeMs: 20000,
      vapid: {},
      waitUntil: undefined,
      logger: expect.objectContaining({
        set: expect.any(Function),
        emit: expect.any(Function),
      }),
    })
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      researchSweepJob: expect.objectContaining({
        job: 'research-job-sweep',
        cron: '*/5 * * * *',
      }),
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      researchSweepResult: {
        selectedCount: 3,
        finalizedCount: 1,
        stillRunningCount: 1,
        failedCount: 1,
        erroredCount: 0,
        runtimeMs: 120,
      },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('emits a failure event with status 500 when the sweep throws', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as SweepLogger)
    const runSweep = vi.fn().mockRejectedValue(new Error('sweep failed'))
    const { runResearchJobSweepJob } = await import(
      '../../../server/plugins/research-job-sweep'
    )

    await runResearchJobSweepJob({
      controller: { cron: '*/5 * * * *', scheduledTime: 1771426560000 },
      config: {
        researchSweepEnabled: true,
        researchSweepBatchSize: 20,
        researchSweepMaxRuntimeMs: 20000,
      },
      vapid: {},
      createLogger,
      runSweep,
    })

    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      researchSweepError: expect.objectContaining({
        phase: 'sweep-run',
      }),
      attributes: expect.objectContaining({
        researchSweepError: expect.objectContaining({
          message: 'sweep failed',
        }),
      }),
    }))
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })
})
