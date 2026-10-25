import { beforeEach, describe, expect, it, vi } from 'vitest'

interface CleanupLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

describe('file-retention cleanup plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('emits success event with cleanup metrics', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as CleanupLogger)
    const runCleanup = vi.fn().mockResolvedValue({
      selectedCount: 3,
      deletedCount: 2,
      failedCount: 1,
      hasMore: false,
      runtimeMs: 120,
    })
    const { runFileRetentionCleanupJob } = await import(
      '../../../server/plugins/file-retention-cleanup'
    )

    await runFileRetentionCleanupJob({
      controller: {
        cron: '* * * * *',
        scheduledTime: 1771426560000,
      },
      config: {
        filesRetentionCleanupEnabled: true,
        filesRetentionCleanupBatchSize: 100,
        filesRetentionCleanupMaxRuntimeMs: 20000,
      },
      createLogger,
      runCleanup,
    })

    expect(runCleanup).toHaveBeenCalledWith({
      batchSize: 100,
      maxRuntimeMs: expect.any(Number),
      logger: expect.objectContaining({
        set: expect.any(Function),
        emit: expect.any(Function),
      }),
    })
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      retentionCleanupJob: expect.objectContaining({
        job: 'file-retention-cleanup',
        cron: '* * * * *',
      }),
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      retentionCleanupResult: {
        selectedCount: 3,
        deletedCount: 2,
        failedCount: 1,
        hasMore: false,
        runtimeMs: expect.any(Number),
        batchCount: 1,
      },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('emits failure event with status 500 when cleanup throws', async () => {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as CleanupLogger)
    const runCleanup = vi.fn().mockRejectedValue(new Error('cleanup failed'))
    const { runFileRetentionCleanupJob } = await import(
      '../../../server/plugins/file-retention-cleanup'
    )

    await runFileRetentionCleanupJob({
      controller: {
        cron: '* * * * *',
        scheduledTime: 1771426560000,
      },
      config: {
        filesRetentionCleanupEnabled: true,
        filesRetentionCleanupBatchSize: 100,
        filesRetentionCleanupMaxRuntimeMs: 20000,
      },
      createLogger,
      runCleanup,
    })

    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      retentionCleanupError: expect.objectContaining({
        phase: 'cleanup-run',
      }),
      attributes: expect.objectContaining({
        retentionCleanupError: expect.objectContaining({
          message: 'cleanup failed',
        }),
      }),
    }))
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })

  it('keeps running batches while hasMore is true within the budget', async () => {
    const createLogger = vi.fn().mockReturnValue({
      set: vi.fn(),
      emit: vi.fn(),
    } as CleanupLogger)
    const runCleanup = vi.fn()
      .mockResolvedValueOnce({
        selectedCount: 100,
        deletedCount: 100,
        failedCount: 0,
        hasMore: true,
        runtimeMs: 10,
      })
      .mockResolvedValueOnce({
        selectedCount: 100,
        deletedCount: 99,
        failedCount: 1,
        hasMore: true,
        runtimeMs: 10,
      })
      .mockResolvedValueOnce({
        selectedCount: 40,
        deletedCount: 40,
        failedCount: 0,
        hasMore: false,
        runtimeMs: 5,
      })
    const { runFileRetentionCleanupJob } = await import(
      '../../../server/plugins/file-retention-cleanup'
    )

    await runFileRetentionCleanupJob({
      controller: {
        cron: '* * * * *',
        scheduledTime: 1771426560000,
      },
      config: {
        filesRetentionCleanupEnabled: true,
        filesRetentionCleanupBatchSize: 100,
        filesRetentionCleanupMaxRuntimeMs: 20000,
      },
      createLogger,
      runCleanup,
    })

    const logger = createLogger.mock.results[0]?.value as CleanupLogger

    expect(runCleanup).toHaveBeenCalledTimes(3)
    expect(logger.set).toHaveBeenCalledWith({
      retentionCleanupResult: {
        selectedCount: 240,
        deletedCount: 239,
        failedCount: 1,
        hasMore: false,
        runtimeMs: expect.any(Number),
        batchCount: 3,
      },
    })
  })

  it('stops looping when the runtime budget is exhausted', async () => {
    vi.useFakeTimers()

    const createLogger = vi.fn().mockReturnValue({
      set: vi.fn(),
      emit: vi.fn(),
    } as CleanupLogger)
    const runCleanup = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(600)

      return {
        selectedCount: 100,
        deletedCount: 100,
        failedCount: 0,
        hasMore: true,
        runtimeMs: 600,
      }
    })
    const { runFileRetentionCleanupJob } = await import(
      '../../../server/plugins/file-retention-cleanup'
    )

    await runFileRetentionCleanupJob({
      controller: {
        cron: '* * * * *',
        scheduledTime: 1771426560000,
      },
      config: {
        filesRetentionCleanupEnabled: true,
        filesRetentionCleanupBatchSize: 100,
        filesRetentionCleanupMaxRuntimeMs: 1000,
      },
      createLogger,
      runCleanup,
    })

    vi.useRealTimers()

    expect(runCleanup).toHaveBeenCalledTimes(2)
  })

  it('stops looping when a batch makes no progress', async () => {
    const createLogger = vi.fn().mockReturnValue({
      set: vi.fn(),
      emit: vi.fn(),
    } as CleanupLogger)
    const runCleanup = vi.fn().mockResolvedValue({
      selectedCount: 100,
      deletedCount: 0,
      failedCount: 100,
      hasMore: true,
      runtimeMs: 10,
    })
    const { runFileRetentionCleanupJob } = await import(
      '../../../server/plugins/file-retention-cleanup'
    )

    await runFileRetentionCleanupJob({
      controller: {
        cron: '* * * * *',
        scheduledTime: 1771426560000,
      },
      config: {
        filesRetentionCleanupEnabled: true,
        filesRetentionCleanupBatchSize: 100,
        filesRetentionCleanupMaxRuntimeMs: 20000,
      },
      createLogger,
      runCleanup,
    })

    expect(runCleanup).toHaveBeenCalledTimes(1)
  })
})
