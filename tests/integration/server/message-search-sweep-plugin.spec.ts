import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SweepLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

describe('message search index sweep plugin', () => {
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
    const { runMessageSearchSweepJob } = await import(
      '../../../server/plugins/message-search-index-sweep'
    )

    await runMessageSearchSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        messageSearchSweepEnabled: false,
        messageSearchSweepBatchSize: 200,
        messageSearchSweepMaxRuntimeMs: 20000,
      },
      createLogger,
      runSweep,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('calls runSweep with clamped batch size and runtime', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as SweepLogger)
    const runSweep = vi.fn().mockResolvedValue({
      backfilledCount: 4,
      garbageCollectedCount: 1,
      hasMore: false,
      runtimeMs: 120,
      nextCursor: 0,
    })
    const { runMessageSearchSweepJob } = await import(
      '../../../server/plugins/message-search-index-sweep'
    )

    await runMessageSearchSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        messageSearchSweepEnabled: true,
        messageSearchSweepBatchSize: 0,
        messageSearchSweepMaxRuntimeMs: 0,
      },
      createLogger,
      runSweep,
    })

    expect(runSweep).toHaveBeenCalledWith({
      batchSize: 1,
      maxRuntimeMs: 1000,
      logger: expect.objectContaining({
        set: expect.any(Function),
        emit: expect.any(Function),
      }),
    })
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchSweepJob: expect.objectContaining({
        job: 'message-search-index-sweep',
        cron: '0 * * * *',
      }),
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      messageSearchSweepResult: {
        backfilledCount: 4,
        garbageCollectedCount: 1,
        hasMore: false,
        runtimeMs: 120,
        nextCursor: 0,
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
    const { runMessageSearchSweepJob } = await import(
      '../../../server/plugins/message-search-index-sweep'
    )

    await runMessageSearchSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        messageSearchSweepEnabled: true,
        messageSearchSweepBatchSize: 200,
        messageSearchSweepMaxRuntimeMs: 20000,
      },
      createLogger,
      runSweep,
    })

    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchSweepError: expect.objectContaining({
        phase: 'sweep-run',
      }),
      attributes: expect.objectContaining({
        messageSearchSweepError: expect.objectContaining({
          message: 'sweep failed',
        }),
      }),
    }))
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })
})
