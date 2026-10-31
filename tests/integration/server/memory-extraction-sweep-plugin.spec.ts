import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SweepLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

const config = {
  memoryExtractionSweepEnabled: true,
  memoryExtractionSweepBatchSize: 20,
  memoryExtractionSweepMaxRuntimeMs: 120000,
  memoryBackfillSweepEnabled: true,
}

const controller = { cron: '*/5 * * * *', scheduledTime: 1771426560000 }

const sweepResult = {
  selectedCount: 3,
  extractedCount: 1,
  skippedCount: 1,
  failedCount: 1,
  erroredCount: 0,
  leasedCount: 0,
  runtimeMs: 120,
  opsApplied: { created: 2, updated: 1, deleted: 0 },
  opsDropped: { ungrounded: 1 },
  models: [],
}

describe('memory extraction sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  async function loadJob() {
    const module = await import('../../../server/plugins/memory-extraction-sweep')

    return module.runMemoryExtractionSweepJob
  }

  function createLoggerMock() {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    } as SweepLogger)

    return { loggerSet, loggerEmit, createLogger }
  }

  it('does nothing when the sweep is disabled', async () => {
    const { createLogger } = createLoggerMock()
    const runSweep = vi.fn()
    const runMemoryExtractionSweepJob = await loadJob()

    await runMemoryExtractionSweepJob({
      controller,
      config: { ...config, memoryExtractionSweepEnabled: false },
      createLogger,
      runSweep,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('emits a success event with counts only', async () => {
    const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
    const runSweep = vi.fn().mockResolvedValue(sweepResult)
    const runMemoryExtractionSweepJob = await loadJob()

    await runMemoryExtractionSweepJob({
      controller,
      config,
      createLogger,
      runSweep,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/memory-extraction-sweep',
      requestId: 'memory-extraction-sweep-1771426560000',
    })
    expect(runSweep).toHaveBeenCalledWith({
      batchSize: 20,
      maxRuntimeMs: 120000,
      isBackfillEnabled: true,
      logger: expect.objectContaining({
        set: expect.any(Function),
        emit: expect.any(Function),
      }),
    })
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        memoryExtractionSweepJob: expect.objectContaining({
          job: 'memory-extraction-sweep',
          cron: '*/5 * * * *',
          batchSize: 20,
          maxRuntimeMs: 120000,
        }),
      },
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      attributes: { memoryExtractionSweepResult: sweepResult },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('ships the emitted wide event to Axiom', async () => {
    const wideEvent = { method: 'CRON', status: 200 }
    const { loggerEmit, createLogger } = createLoggerMock()
    const shipWideEvent = vi.fn().mockResolvedValue([])
    const runMemoryExtractionSweepJob = await loadJob()

    loggerEmit.mockReturnValue(wideEvent)

    await runMemoryExtractionSweepJob({
      controller,
      config,
      createLogger,
      runSweep: vi.fn().mockResolvedValue(sweepResult),
      shipWideEvent,
    })

    expect(shipWideEvent).toHaveBeenCalledTimes(1)
    expect(shipWideEvent).toHaveBeenCalledWith(wideEvent)
  })

  it('emits a failure event with status 500 when the sweep throws', async () => {
    const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
    const runSweep = vi.fn().mockRejectedValue(new Error('sweep failed'))
    const runMemoryExtractionSweepJob = await loadJob()

    await runMemoryExtractionSweepJob({
      controller,
      config,
      createLogger,
      runSweep,
    })

    expect(loggerSet).toHaveBeenCalledWith({
      attributes: {
        memoryExtractionSweepError: {
          phase: 'sweep-run',
          errorName: 'Error',
        },
      },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })

  it('tells the sweep to skip backfill when the backfill switch is off',
    async () => {
      const { createLogger } = createLoggerMock()
      const runSweep = vi.fn().mockResolvedValue(sweepResult)
      const runMemoryExtractionSweepJob = await loadJob()

      await runMemoryExtractionSweepJob({
        controller,
        config: { ...config, memoryBackfillSweepEnabled: false },
        createLogger,
        runSweep,
      })

      expect(runSweep).toHaveBeenCalledWith(
        expect.objectContaining({ isBackfillEnabled: false }),
      )
    })

  it('logs the error class and status, never message or stack', async () => {
    const { loggerSet, createLogger } = createLoggerMock()
    const failure = Object.assign(new Error('secret text in message'), {
      status: 503,
    })

    failure.stack = 'secret text in stack'

    const runMemoryExtractionSweepJob = await loadJob()

    await runMemoryExtractionSweepJob({
      controller,
      config,
      createLogger,
      runSweep: vi.fn().mockRejectedValue(failure),
    })

    const logged = JSON.stringify(loggerSet.mock.calls)

    expect(logged).toContain('"errorName":"Error"')
    expect(logged).toContain('"status":503')
    expect(logged).not.toContain('secret text')
  })

  it('registers a cron hook for the shared five-minute schedule', async () => {
    const hooks: Record<string, (payload: unknown) => Promise<void>> = {}
    const module = await import('../../../server/plugins/memory-extraction-sweep')

    ;(module.default as unknown as (app: unknown) => void)({
      hooks: {
        hook: (name: string, handler: (payload: unknown) => Promise<void>) => {
          hooks[name] = handler
        },
      },
    })

    expect(Object.keys(hooks)).toEqual(['cloudflare:scheduled'])

    await hooks['cloudflare:scheduled']!({
      controller: { cron: '0 * * * *', scheduledTime: 1 },
      context: { waitUntil: vi.fn() },
    })
  })
})
