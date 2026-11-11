import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

const controller = { cron: '*/5 * * * *', scheduledTime: 1771426560000 }

describe('feature schedule applier plugin', () => {
  const db = { name: 'db' }
  const kv = { name: 'kv' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useRuntimeConfig', () => ({
      featuresRolloutEnabled: '',
    }))
  })

  function createLoggerMock() {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn().mockReturnValue({ status: 200 })
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    })

    return { loggerSet, loggerEmit, createLogger }
  }

  async function loadModule() {
    vi.doMock(
      '~~/server/utils/features/schedule-notify',
      () => ({ createFeatureScheduleNotifier: () => vi.fn() }),
    )

    return await import('../../../server/plugins/feature-schedule-applier')
  }

  it('applies due steps at the scheduled time with the configured override', async () => {
    const module = await loadModule()
    const applyDue = vi.fn().mockResolvedValue({ applied: 2, failed: 0 })
    const { createLogger, loggerSet, loggerEmit } = createLoggerMock()
    const shipWideEvent = vi.fn()

    await module.runFeatureScheduleApplierJob({
      controller,
      createLogger: createLogger as never,
      shipWideEvent,
      applyDue,
    })

    expect(applyDue).toHaveBeenCalledWith(expect.objectContaining({
      db,
      kv,
      now: new Date(controller.scheduledTime),
      rolloutOverride: '',
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      attributes: { featureScheduleResult: { applied: 2, failed: 0 } },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
    expect(shipWideEvent).toHaveBeenCalled()
  })

  it('reports a crashed run as a 500 without throwing', async () => {
    const module = await loadModule()
    const applyDue = vi.fn().mockRejectedValue(new Error('d1 down'))
    const { createLogger, loggerSet, loggerEmit } = createLoggerMock()

    await module.runFeatureScheduleApplierJob({
      controller,
      createLogger: createLogger as never,
      shipWideEvent: vi.fn(),
      applyDue,
    })

    expect(loggerSet).toHaveBeenCalledWith({
      attributes: { featureScheduleJob: { error: 'd1 down' } },
    })
    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })

  it('registers a hook that only reacts to the five-minute cron', async () => {
    const hooks: Record<string, (payload: unknown) => Promise<void>> = {}
    const module = await loadModule()
    const useDbSpy = vi.fn()

    vi.stubGlobal('useDb', useDbSpy)
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

    expect(useDbSpy).not.toHaveBeenCalled()
  })
})
