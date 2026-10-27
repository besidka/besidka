import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SweepLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

const config = {
  memoryBackfillSweepEnabled: true,
  memoryBackfillSweepMaxRuntimeMs: 45000,
}

const controller = { cron: '* * * * *', scheduledTime: 1771426560000 }

const sweepResult = { jobs: 1, chats: 23, completed: 1, failed: 0 }

const mocks = vi.hoisted(() => ({
  sweepBackfillJobs: vi.fn(),
}))

vi.mock('~~/server/utils/memory/backfill', () => ({
  sweepBackfillJobs: mocks.sweepBackfillJobs,
}))

describe('memory backfill sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  async function loadModule() {
    return await import('../../../server/plugins/memory-backfill-sweep')
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

  function registerHooks(plugin: unknown) {
    const hooks: Record<string, (payload: unknown) => Promise<void>> = {}

    ;(plugin as (app: unknown) => void)({
      hooks: {
        hook: (name: string, handler: (payload: unknown) => Promise<void>) => {
          hooks[name] = handler
        },
      },
    })

    return hooks
  }

  it('does nothing when the sweep is disabled', async () => {
    const { createLogger } = createLoggerMock()
    const runSweep = vi.fn()
    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({
      controller,
      config: { ...config, memoryBackfillSweepEnabled: false },
      createLogger,
      runSweep,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('runs the backfill sweep with its own budget and logs counts only',
    async () => {
      const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
      const runSweep = vi.fn().mockResolvedValue(sweepResult)
      const { runMemoryBackfillSweepJob } = await loadModule()

      await runMemoryBackfillSweepJob({
        controller,
        config,
        createLogger,
        runSweep,
      })

      expect(createLogger).toHaveBeenCalledWith({
        method: 'CRON',
        path: '/internal/jobs/memory-backfill-sweep',
        requestId: 'memory-backfill-sweep-1771426560000',
      })
      expect(runSweep).toHaveBeenCalledWith({
        maxRuntimeMs: 45000,
        logger: expect.objectContaining({ set: expect.any(Function) }),
      })
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryBackfillSweep: {
            ...sweepResult,
            runtimeMs: expect.any(Number),
          },
        },
      })
      expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
    })

  it('emits status 500 with the error class only when the sweep throws',
    async () => {
      const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
      const failure = new Error('secret text in message')
      const { runMemoryBackfillSweepJob } = await loadModule()

      await runMemoryBackfillSweepJob({
        controller,
        config,
        createLogger,
        runSweep: vi.fn().mockRejectedValue(failure),
      })

      const logged = JSON.stringify(loggerSet.mock.calls)

      expect(logged).toContain('memoryBackfillSweepError')
      expect(logged).not.toContain('secret text')
      expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
    })

  it('ignores the five-minute and hourly schedules', async () => {
    const module = await loadModule()
    const hooks = registerHooks(module.default)

    expect(Object.keys(hooks)).toEqual(['cloudflare:scheduled'])

    for (const cron of ['*/5 * * * *', '0 * * * *']) {
      await hooks['cloudflare:scheduled']!({
        controller: { cron, scheduledTime: 1 },
        context: { waitUntil: vi.fn() },
      })
    }

    expect(mocks.sweepBackfillJobs).not.toHaveBeenCalled()
  })

  it('runs sweepBackfillJobs by default', async () => {
    const { createLogger } = createLoggerMock()

    mocks.sweepBackfillJobs.mockResolvedValue(sweepResult)

    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({ controller, config, createLogger })

    expect(mocks.sweepBackfillJobs).toHaveBeenCalledTimes(1)
    expect(mocks.sweepBackfillJobs).toHaveBeenCalledWith(
      expect.objectContaining({ maxRuntimeMs: 45000 }),
    )
  })

  it('emits the event when the sweep did work', async () => {
    const { createLogger, loggerEmit } = createLoggerMock()

    mocks.sweepBackfillJobs.mockResolvedValue(sweepResult)

    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({ controller, config, createLogger })

    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('stays silent when there was nothing to do', async () => {
    const { createLogger, loggerEmit } = createLoggerMock()

    mocks.sweepBackfillJobs.mockResolvedValue({
      jobs: 0,
      chats: 0,
      completed: 0,
      failed: 0,
    })

    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({ controller, config, createLogger })

    expect(mocks.sweepBackfillJobs).toHaveBeenCalledTimes(1)
    expect(loggerEmit).not.toHaveBeenCalled()
  })

  it('emits when jobs failed even if no chat was processed', async () => {
    const { createLogger, loggerEmit } = createLoggerMock()

    mocks.sweepBackfillJobs.mockResolvedValue({
      jobs: 0,
      chats: 0,
      completed: 0,
      failed: 1,
    })

    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({ controller, config, createLogger })

    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('still emits a 500 event when the sweep throws', async () => {
    const { createLogger, loggerEmit } = createLoggerMock()

    mocks.sweepBackfillJobs.mockRejectedValue(new Error('sweep failed'))

    const { runMemoryBackfillSweepJob } = await loadModule()

    await runMemoryBackfillSweepJob({ controller, config, createLogger })

    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })
})
