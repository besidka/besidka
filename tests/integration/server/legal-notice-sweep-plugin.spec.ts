import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

const config = {
  legalNoticeSweepEnabled: true,
  legalNoticeSweepBatchSize: 25,
  legalNoticeSweepMaxRuntimeMs: 60000,
  legalNoticeDailyCap: 300,
  privacyEmail: 'privacy@example.test',
}

const controller = { cron: '*/5 * * * *', scheduledTime: 1771426560000 }

const sweepResult = {
  selectedCount: 3,
  sentCount: 2,
  skippedCount: 1,
  failedCount: 0,
  lateDeliveries: 0,
  claimMissedCount: 0,
  userDeletedCount: 0,
  errorCodes: { E_RECIPIENT_SUPPRESSED: 1 },
  notices: [{
    noticeId: '2026-11-legal-notices',
    selectedCount: 3,
    sentCount: 2,
    skippedCount: 1,
    failedCount: 0,
    lateDeliveries: 0,
  }],
  stopReason: 'completed',
  runtimeMs: 120,
}

describe('legal notice sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  async function loadJob() {
    const module = await import('../../../server/plugins/legal-notice-sweep')

    return module.runLegalNoticeSweepJob
  }

  function createLoggerMock() {
    const loggerSet = vi.fn()
    const loggerEmit = vi.fn()
    const createLogger = vi.fn().mockReturnValue({
      set: loggerSet,
      emit: loggerEmit,
    })

    return { loggerSet, loggerEmit, createLogger }
  }

  it('does nothing when the sweep is disabled', async () => {
    const { createLogger } = createLoggerMock()
    const runSweep = vi.fn()
    const runLegalNoticeSweepJob = await loadJob()

    await runLegalNoticeSweepJob({
      controller,
      config: { ...config, legalNoticeSweepEnabled: false },
      createLogger,
      runSweep,
      isDevelopment: false,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('does nothing in development even when enabled', async () => {
    const { createLogger } = createLoggerMock()
    const runSweep = vi.fn()
    const runLegalNoticeSweepJob = await loadJob()

    await runLegalNoticeSweepJob({
      controller,
      config,
      createLogger,
      runSweep,
      isDevelopment: true,
    })

    expect(runSweep).not.toHaveBeenCalled()
    expect(createLogger).not.toHaveBeenCalled()
  })

  it('emits a success event with counts and codes only', async () => {
    const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
    const runSweep = vi.fn().mockResolvedValue(sweepResult)
    const runLegalNoticeSweepJob = await loadJob()

    await runLegalNoticeSweepJob({
      controller,
      config,
      createLogger,
      runSweep,
      isDevelopment: false,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/legal-notice-sweep',
      requestId: 'legal-notice-sweep-1771426560000',
    })
    expect(runSweep).toHaveBeenCalledWith({
      batchSize: 25,
      maxRuntimeMs: 60000,
      dailyCap: 300,
      privacyEmail: 'privacy@example.test',
      logger: expect.objectContaining({
        set: expect.any(Function),
        emit: expect.any(Function),
      }),
    })
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        legalNoticeSweepJob: expect.objectContaining({
          job: 'legal-notice-sweep',
          cron: '*/5 * * * *',
          batchSize: 25,
          maxRuntimeMs: 60000,
          dailyCap: 300,
        }),
      },
    }))
    expect(loggerSet).toHaveBeenCalledWith({
      attributes: { legalNoticeSweepResult: sweepResult },
    })
    expect(JSON.stringify(loggerSet.mock.calls)).not.toContain('@')
    expect(loggerEmit).toHaveBeenCalledWith({ status: 200 })
  })

  it('emits status 500 when the sweep stopped on a bookkeeping error',
    async () => {
      const { loggerEmit, createLogger } = createLoggerMock()
      const runLegalNoticeSweepJob = await loadJob()

      await runLegalNoticeSweepJob({
        controller,
        config,
        createLogger,
        runSweep: vi.fn().mockResolvedValue({
          ...sweepResult,
          stopReason: 'error',
        }),
        isDevelopment: false,
      })

      expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
    })

  it.each([
    'consecutive-failures',
    'email-noop',
  ])('emits status 500 when the sweep stopped on %s', async (stopReason) => {
    const { loggerEmit, createLogger } = createLoggerMock()
    const runLegalNoticeSweepJob = await loadJob()

    await runLegalNoticeSweepJob({
      controller,
      config,
      createLogger,
      runSweep: vi.fn().mockResolvedValue({
        ...sweepResult,
        failedCount: 3,
        stopReason,
      }),
      isDevelopment: false,
    })

    expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
  })

  it('emits a failure event with status 500 when the sweep throws',
    async () => {
      const { loggerSet, loggerEmit, createLogger } = createLoggerMock()
      const runLegalNoticeSweepJob = await loadJob()

      await runLegalNoticeSweepJob({
        controller,
        config,
        createLogger,
        runSweep: vi.fn().mockRejectedValue(new Error('sweep failed')),
        isDevelopment: false,
      })

      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          legalNoticeSweepError: {
            phase: 'sweep-run',
            message: 'sweep failed',
          },
        },
      })
      expect(loggerEmit).toHaveBeenCalledWith({ status: 500 })
    })

  it('registers a hook that only reacts to the five-minute cron', async () => {
    const hooks: Record<string, (payload: unknown) => Promise<void>> = {}
    const module = await import('../../../server/plugins/legal-notice-sweep')

    ;(module.default as unknown as (app: unknown) => void)({
      hooks: {
        hook: (name: string, handler: (payload: unknown) => Promise<void>) => {
          hooks[name] = handler
        },
      },
    })

    expect(Object.keys(hooks)).toEqual(['cloudflare:scheduled'])

    const useRuntimeConfig = vi.fn()

    vi.stubGlobal('useRuntimeConfig', useRuntimeConfig)

    await hooks['cloudflare:scheduled']!({
      controller: { cron: '0 * * * *', scheduledTime: 1 },
      context: { waitUntil: vi.fn() },
    })

    expect(useRuntimeConfig).not.toHaveBeenCalled()
  })
})
