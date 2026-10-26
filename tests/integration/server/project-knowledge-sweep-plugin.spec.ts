import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sweepProjectKnowledge: vi.fn(),
}))

vi.mock('~~/server/utils/knowledge/sweep', () => ({
  sweepProjectKnowledge: mocks.sweepProjectKnowledge,
}))

interface SweepLogger {
  set: (data: Record<string, unknown>) => void
  emit: (data: Record<string, unknown>) => void
}

const SWEEP_RESULT = {
  pagesScanned: 2,
  scannedCount: 120,
  orphanItemObjectsDeleted: 3,
  orphanProjectObjectsDeleted: 1,
  stalePackObjectsDeleted: 4,
  youngSkippedCount: 5,
  unrecognizedCount: 0,
  failedDeleteCount: 0,
  hasMore: false,
  runtimeMs: 120,
}

function createLogger() {
  const set = vi.fn()
  const emit = vi.fn()
  const createLoggerMock = vi.fn().mockReturnValue({
    set,
    emit,
  } as SweepLogger)

  return { set, emit, createLoggerMock }
}

describe('project knowledge sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  it('does nothing when the sweep is disabled', async () => {
    const { createLoggerMock } = createLogger()
    const runSweep = vi.fn()
    const { runProjectKnowledgeSweepJob } = await import(
      '../../../server/plugins/project-knowledge-sweep'
    )

    await runProjectKnowledgeSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        knowledgeSweepEnabled: false,
        knowledgeSweepBatchSize: 1000,
        knowledgeSweepMaxRuntimeMs: 20000,
      },
      createLogger: createLoggerMock,
      runSweep,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLoggerMock).not.toHaveBeenCalled()
  })

  it('runs the sweep with clamped batch size and runtime and logs counts', async () => {
    const { set, emit, createLoggerMock } = createLogger()
    const runSweep = vi.fn().mockResolvedValue(SWEEP_RESULT)
    const { runProjectKnowledgeSweepJob } = await import(
      '../../../server/plugins/project-knowledge-sweep'
    )

    await runProjectKnowledgeSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        knowledgeSweepEnabled: true,
        knowledgeSweepBatchSize: 0,
        knowledgeSweepMaxRuntimeMs: 0,
      },
      createLogger: createLoggerMock,
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
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        projectKnowledgeSweepJob: expect.objectContaining({
          job: 'project-knowledge-sweep',
          cron: '0 * * * *',
        }),
      },
    }))
    expect(set).toHaveBeenCalledWith({
      attributes: { projectKnowledgeSweepResult: SWEEP_RESULT },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('emits a failure event with status 500 when the sweep throws', async () => {
    const { set, emit, createLoggerMock } = createLogger()
    const runSweep = vi.fn().mockRejectedValue(new Error('sweep failed'))
    const { runProjectKnowledgeSweepJob } = await import(
      '../../../server/plugins/project-knowledge-sweep'
    )

    await runProjectKnowledgeSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      config: {
        knowledgeSweepEnabled: true,
        knowledgeSweepBatchSize: 1000,
        knowledgeSweepMaxRuntimeMs: 20000,
      },
      createLogger: createLoggerMock,
      runSweep,
    })

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: expect.objectContaining({
        projectKnowledgeSweepError: expect.objectContaining({
          phase: 'sweep-run',
          message: 'sweep failed',
        }),
      }),
    }))
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  describe('scheduled hook', () => {
    async function registerHandler() {
      const hooks: Record<string, (payload: unknown) => Promise<void>> = {}
      const module = await import(
        '../../../server/plugins/project-knowledge-sweep'
      )

      ;(module.default as unknown as (app: unknown) => void)({
        hooks: {
          hook: (
            name: string,
            handler: (payload: unknown) => Promise<void>,
          ) => {
            hooks[name] = handler
          },
        },
      })

      return hooks
    }

    it('registers one scheduled hook', async () => {
      const hooks = await registerHandler()

      expect(Object.keys(hooks)).toEqual(['cloudflare:scheduled'])
    })

    it('ignores other crons', async () => {
      const hooks = await registerHandler()

      await hooks['cloudflare:scheduled']!({
        controller: { cron: '*/5 * * * *', scheduledTime: 1771426560000 },
      })

      expect(mocks.sweepProjectKnowledge).not.toHaveBeenCalled()
    })

    it('stays idle on the hourly cron while the toggle is unset', async () => {
      const hooks = await registerHandler()

      await hooks['cloudflare:scheduled']!({
        controller: { cron: '0 * * * *', scheduledTime: 1771426560000 },
      })

      expect(mocks.sweepProjectKnowledge).not.toHaveBeenCalled()
    })
  })
})
