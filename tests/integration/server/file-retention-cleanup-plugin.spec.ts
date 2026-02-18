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
      maxRuntimeMs: 20000,
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
        runtimeMs: 120,
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
        message: 'cleanup failed',
      }),
    }))
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })
})
