import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillProgress,
} from '../../../shared/types/memory-backfill.d'
import { useMemoryBackfill } from '../../../app/composables/memory-backfill'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: async () => true,
  handleConsentError: async () => false,
}))

const BACKFILL_URL = '/api/v1/memory/backfill'
const STEP_URL = '/api/v1/memory/backfill/step'
const CANCEL_URL = '/api/v1/memory/backfill/cancel'
const COOLDOWN_MS = 10_000

const estimate: MemoryBackfillEstimate = {
  chats: 48,
  userChars: 90_000,
  transcriptChars: 240_000,
  inputTokens: 310_000,
  outputTokens: 42_000,
  overheadTokensPerChat: 900,
  pricePerMillion: { input: 1, output: 5 },
  costUsd: 0.52,
  approximate: true,
  model: {
    source: 'setting',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-5-mini',
    modelName: 'GPT-5 mini',
  },
}

function createJob(
  overrides: Partial<MemoryBackfillProgress> = {},
): MemoryBackfillProgress {
  return {
    id: 'job-1',
    status: 'running',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: null,
    totalChats: 48,
    processedChats: 0,
    createdEntries: 0,
    updatedEntries: 0,
    skippedChats: 0,
    failedChats: 0,
    inputTokens: 0,
    outputTokens: 0,
    failureReason: null,
    dropped: {},
    model: null,
    estimate: null,
    ...overrides,
  }
}

function createRejection(
  statusCode: number,
  message: string,
  why: string,
  headers: Record<string, string> = {},
) {
  return Object.assign(new Error('Request failed'), {
    data: { statusCode, message, data: { why } },
    response: {
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
    },
  })
}

function callsTo(url: string) {
  return mocks.fetch.mock.calls.filter(([calledUrl]) => calledUrl === url)
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function mockRunningOverview(
  job: MemoryBackfillProgress = createJob(),
) {
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url === BACKFILL_URL) {
      return { job, estimate: null, reason: null }
    }

    throw new Error(`Unexpected request ${url}`)
  })
}

describe('useMemoryBackfill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.fetch.mockReset()
    clearNuxtState('memory-backfill-overview')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('load', () => {
    it('stores the overview of an idle account', async () => {
      mocks.fetch.mockResolvedValue({
        job: null,
        estimate,
        reason: null,
      })

      const backfill = useMemoryBackfill()

      await backfill.load()

      expect(mocks.fetch).toHaveBeenCalledWith(BACKFILL_URL, { query: {} })
      expect(backfill.estimate.value).toEqual(estimate)
      expect(backfill.job.value).toBeNull()
      expect(backfill.reason.value).toBeNull()
      expect(backfill.isRunning.value).toBe(false)
      expect(backfill.error.value).toBeNull()
    })

    it('exposes the unavailable reason', async () => {
      mocks.fetch.mockResolvedValue({
        job: null,
        estimate: null,
        reason: 'no-model',
      })

      const backfill = useMemoryBackfill()

      await backfill.load()

      expect(backfill.reason.value).toBe('no-model')
      expect(backfill.estimate.value).toBeNull()
    })

    it('tracks the loading flag around the request', async () => {
      const pending = deferred<unknown>()

      mocks.fetch.mockReturnValue(pending.promise)

      const backfill = useMemoryBackfill()
      const loading = backfill.load()

      expect(backfill.isLoading.value).toBe(true)

      pending.resolve({ job: null, estimate, reason: null })
      await loading

      expect(backfill.isLoading.value).toBe(false)
    })

    it('maps a failed load to an error message', async () => {
      mocks.fetch.mockRejectedValue(
        createRejection(500, 'Could not read the backfill', 'D1 is down'),
      )

      const backfill = useMemoryBackfill()
      const isApplied = await backfill.load()

      expect(isApplied).toBe(false)
      expect(backfill.error.value).toEqual({
        message: 'Could not read the backfill',
        why: 'D1 is down',
        status: 500,
      })
    })

    it('ignores a late response that a newer one already replaced', async () => {
      const first = deferred<unknown>()
      const second = deferred<unknown>()

      mocks.fetch
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      const backfill = useMemoryBackfill()
      const firstLoad = backfill.load()
      const secondLoad = backfill.load()

      second.resolve({
        job: createJob({ processedChats: 30 }),
        estimate: null,
        reason: null,
      })
      await secondLoad

      first.resolve({
        job: createJob({ processedChats: 3 }),
        estimate: null,
        reason: null,
      })

      await expect(firstLoad).resolves.toBe(false)
      expect(backfill.job.value?.processedChats).toBe(30)
    })
  })

  describe('start', () => {
    it('posts once and stores the running job', async () => {
      const job = createJob()

      mocks.fetch.mockResolvedValue({ job })

      const backfill = useMemoryBackfill()
      const isStarted = await backfill.start()

      expect(isStarted).toBe(true)
      expect(mocks.fetch).toHaveBeenCalledWith(BACKFILL_URL, {
        method: 'POST',
      })
      expect(backfill.job.value).toEqual(job)
      expect(backfill.isRunning.value).toBe(true)
      expect(backfill.isStarting.value).toBe(false)
    })

    it.each([
      [{}, { query: {} }, { method: 'POST' }],
      [
        { restart: true },
        { query: { restart: 'true' } },
        { method: 'POST', body: { restart: true } },
      ],
    ])('sends the restart flag only when asked (%o)', async (
      options,
      loadInit,
      startInit,
    ) => {
      mocks.fetch.mockResolvedValue({ job: createJob() })

      const backfill = useMemoryBackfill()

      await backfill.load(options)
      await backfill.start(options)

      expect(mocks.fetch).toHaveBeenNthCalledWith(1, BACKFILL_URL, loadInit)
      expect(mocks.fetch).toHaveBeenNthCalledWith(2, BACKFILL_URL, startInit)
    })

    it('ignores a second start while one is in flight', async () => {
      const pending = deferred<unknown>()

      mocks.fetch.mockReturnValue(pending.promise)

      const backfill = useMemoryBackfill()
      const firstStart = backfill.start()

      expect(backfill.isStarting.value).toBe(true)
      await expect(backfill.start()).resolves.toBe(false)

      pending.resolve({ job: createJob() })
      await firstStart

      expect(callsTo(BACKFILL_URL)).toHaveLength(1)
    })

    it('reloads the overview after a 409 so the state matches', async () => {
      const runningJob = createJob({ processedChats: 7 })

      mocks.fetch.mockImplementation(
        async (_url: string, options?: { method: string }) => {
          if (options?.method === 'POST') {
            throw createRejection(
              409,
              'A backfill is already running',
              'Only one backfill can run at a time.',
            )
          }

          return { job: runningJob, estimate: null, reason: null }
        },
      )

      const backfill = useMemoryBackfill()
      const isStarted = await backfill.start()

      expect(isStarted).toBe(false)
      expect(backfill.error.value?.message)
        .toBe('A backfill is already running')
      expect(backfill.job.value?.processedChats).toBe(7)
    })

    it('shows the cooldown copy for a 429', async () => {
      mocks.fetch.mockRejectedValue(
        createRejection(429, 'Backfill was requested moments ago', 'x'),
      )

      const backfill = useMemoryBackfill()

      await backfill.start()

      expect(backfill.error.value).toEqual({
        message: 'Please wait a moment',
        why: 'Try again in a few seconds.',
        status: 429,
      })
    })
  })

  describe('step', () => {
    it('stores the job returned by one step', async () => {
      mocks.fetch.mockResolvedValue({
        job: createJob({ processedChats: 12, createdEntries: 3 }),
      })

      const backfill = useMemoryBackfill()
      const result = await backfill.step()

      expect(result.outcome).toBe('advanced')
      expect(mocks.fetch).toHaveBeenCalledWith(STEP_URL, { method: 'POST' })
      expect(backfill.job.value?.processedChats).toBe(12)
    })

    it('does not run two steps at once', async () => {
      const pending = deferred<unknown>()

      mocks.fetch.mockReturnValue(pending.promise)

      const backfill = useMemoryBackfill()
      const firstStep = backfill.step()
      const secondStep = await backfill.step()

      expect(secondStep.outcome).toBe('busy')

      pending.resolve({ job: createJob() })
      await firstStep

      expect(callsTo(STEP_URL)).toHaveLength(1)
    })

    it('reports a cooldown with the default ten seconds', async () => {
      mocks.fetch.mockRejectedValue(
        createRejection(429, 'Backfill was requested moments ago', 'x'),
      )

      const backfill = useMemoryBackfill()
      const result = await backfill.step()

      expect(result).toEqual({
        outcome: 'cooldown',
        retryAfterMs: COOLDOWN_MS,
      })
      expect(backfill.error.value).toBeNull()
    })

    it('reads Retry-After when the response carries it', async () => {
      mocks.fetch.mockRejectedValue(
        createRejection(429, 'Slow down', 'x', { 'retry-after': '3' }),
      )

      const backfill = useMemoryBackfill()
      const result = await backfill.step()

      expect(result.retryAfterMs).toBe(3000)
    })

    it('reloads on a 409 because no backfill is running', async () => {
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === STEP_URL) {
          throw createRejection(409, 'No running backfill', 'x')
        }

        return {
          job: createJob({ status: 'completed', finishedAt: 'x' }),
          estimate: null,
          reason: null,
        }
      })

      const backfill = useMemoryBackfill()
      const result = await backfill.step()

      expect(result.outcome).toBe('idle')
      expect(backfill.job.value?.status).toBe('completed')
    })
  })

  describe('cancel', () => {
    it('stores the cancelled job', async () => {
      mocks.fetch.mockResolvedValue({
        job: createJob({ status: 'cancelled', finishedAt: 'x' }),
      })

      const backfill = useMemoryBackfill()
      const isCancelled = await backfill.cancel()

      expect(isCancelled).toBe(true)
      expect(mocks.fetch).toHaveBeenCalledWith(CANCEL_URL, {
        method: 'POST',
      })
      expect(backfill.job.value?.status).toBe('cancelled')
      expect(backfill.isCancelling.value).toBe(false)
    })

    it('reloads when the server answers with no job', async () => {
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === CANCEL_URL) {
          return { job: null }
        }

        return { job: null, estimate, reason: null }
      })

      const backfill = useMemoryBackfill()

      await backfill.cancel()

      expect(callsTo(BACKFILL_URL)).toHaveLength(1)
      expect(backfill.estimate.value).toEqual(estimate)
    })

    it('stops polling before the request goes out', async () => {
      const pending = deferred<unknown>()

      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockImplementation((url: string) => {
        if (url === STEP_URL) {
          return Promise.resolve({ job: createJob({ processedChats: 6 }) })
        }

        return pending.promise
      })

      backfill.startPolling()
      await flushPromises()

      const cancelling = backfill.cancel()

      expect(backfill.isPolling.value).toBe(false)

      pending.resolve({
        job: createJob({ status: 'cancelled', finishedAt: 'x' }),
      })
      await cancelling
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.job.value?.status).toBe('cancelled')
    })

    it('resumes polling when cancelling fails', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === CANCEL_URL) {
          throw createRejection(500, 'Could not stop', 'D1 is down')
        }

        return { job: createJob({ processedChats: 4 }) }
      })

      backfill.startPolling()
      await flushPromises()

      const isCancelled = await backfill.cancel()

      expect(isCancelled).toBe(false)
      expect(backfill.error.value?.message).toBe('Could not stop')

      await vi.advanceTimersByTimeAsync(COOLDOWN_MS + 500)

      expect(callsTo(STEP_URL).length).toBeGreaterThan(1)
      backfill.stopPolling()
    })

    it('drops a late step response after the job was cancelled', async () => {
      const pendingStep = deferred<unknown>()

      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === STEP_URL) {
          return await pendingStep.promise
        }

        return { job: createJob({ status: 'cancelled', finishedAt: 'x' }) }
      })

      const stepping = backfill.step()

      await backfill.cancel()

      pendingStep.resolve({ job: createJob({ processedChats: 24 }) })
      await stepping

      expect(backfill.job.value?.status).toBe('cancelled')
    })
  })

  describe('polling', () => {
    it('drives a step right away and again after the cooldown', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockResolvedValue({
        job: createJob({ processedChats: 12 }),
      })

      backfill.startPolling()
      await flushPromises()

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.isPolling.value).toBe(true)

      await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1)

      expect(callsTo(STEP_URL)).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(500)

      expect(callsTo(STEP_URL)).toHaveLength(2)
      backfill.stopPolling()
    })

    it('only starts one loop when started twice', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockResolvedValue({ job: createJob() })

      backfill.startPolling()
      backfill.startPolling()
      await flushPromises()

      expect(callsTo(STEP_URL)).toHaveLength(1)
      backfill.stopPolling()
    })

    it('does nothing when no job is running', async () => {
      mocks.fetch.mockResolvedValue({ job: null, estimate, reason: null })

      const backfill = useMemoryBackfill()

      await backfill.load()
      backfill.startPolling()
      await flushPromises()

      expect(backfill.isPolling.value).toBe(false)
      expect(callsTo(STEP_URL)).toHaveLength(0)
    })

    it('waits out a 429 and retries after the cooldown', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch
        .mockReset()
        .mockRejectedValueOnce(
          createRejection(429, 'Backfill was requested moments ago', 'x'),
        )
        .mockResolvedValue({ job: createJob({ processedChats: 12 }) })

      backfill.startPolling()
      await flushPromises()

      expect(callsTo(STEP_URL)).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1)

      expect(callsTo(STEP_URL)).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)

      expect(callsTo(STEP_URL)).toHaveLength(2)
      expect(backfill.job.value?.processedChats).toBe(12)
      backfill.stopPolling()
    })

    it('waits the Retry-After seconds when the 429 carries them', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch
        .mockReset()
        .mockRejectedValueOnce(
          createRejection(429, 'Slow down', 'x', { 'retry-after': '4' }),
        )
        .mockResolvedValue({ job: createJob({ processedChats: 12 }) })

      backfill.startPolling()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(3999)

      expect(callsTo(STEP_URL)).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)

      expect(callsTo(STEP_URL)).toHaveLength(2)
      backfill.stopPolling()
    })

    it('never runs two steps at the same time', async () => {
      const pendingStep = deferred<unknown>()

      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockReturnValue(pendingStep.promise)

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 5)

      expect(callsTo(STEP_URL)).toHaveLength(1)

      pendingStep.resolve({ job: createJob({ processedChats: 12 }) })
      await flushPromises()
      backfill.stopPolling()
    })

    it('stops once the job is no longer running', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockResolvedValue({
        job: createJob({
          status: 'completed',
          finishedAt: '2026-10-25T10:05:00.000Z',
          processedChats: 48,
        }),
      })

      backfill.startPolling()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.isPolling.value).toBe(false)
      expect(backfill.isRunning.value).toBe(false)
    })

    it('stops when asked, even during the cooldown wait', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockResolvedValue({ job: createJob({ processedChats: 6 }) })

      backfill.startPolling()
      await flushPromises()
      backfill.stopPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.isPolling.value).toBe(false)
    })

    it('stops when the owning scope is disposed', async () => {
      const scope = effectScope()
      const backfill = scope.run(() => useMemoryBackfill())!

      mockRunningOverview()

      await backfill.load()

      mocks.fetch.mockResolvedValue({ job: createJob({ processedChats: 6 }) })

      backfill.startPolling()
      await flushPromises()
      scope.stop()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.isPolling.value).toBe(false)
    })

    it('reloads and stops when the server has no running job', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === STEP_URL) {
          throw createRejection(409, 'No running backfill', 'x')
        }

        return {
          job: createJob({ status: 'completed', finishedAt: 'x' }),
          estimate: null,
          reason: null,
        }
      })

      backfill.startPolling()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.job.value?.status).toBe('completed')
      expect(backfill.isPolling.value).toBe(false)
    })

    it('gives up after three failed steps in a row', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockReset().mockRejectedValue(
        createRejection(500, 'Step failed', 'Model timed out'),
      )

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 6)

      expect(callsTo(STEP_URL)).toHaveLength(3)
      expect(backfill.isPolling.value).toBe(false)
      expect(backfill.error.value?.message).toBe('Step failed')
    })

    it('reports a paused state after three failed steps in a row', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      expect(backfill.isPaused.value).toBe(false)
      expect(backfill.pollError.value).toBeNull()

      mocks.fetch.mockReset().mockRejectedValue(
        createRejection(500, 'Step failed', 'Model timed out'),
      )

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 6)

      expect(backfill.isPaused.value).toBe(true)
      expect(backfill.pollError.value?.message).toBe('Step failed')
      expect(backfill.pollError.value?.why).toBe('Model timed out')
      expect(backfill.isRunning.value).toBe(true)
    })

    it('does not pause when a step succeeds between failures', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockReset()
        .mockRejectedValueOnce(createRejection(500, 'Step failed', 'x'))
        .mockRejectedValueOnce(createRejection(500, 'Step failed', 'x'))
        .mockResolvedValueOnce({ job: createJob({ processedChats: 2 }) })
        .mockRejectedValueOnce(createRejection(500, 'Step failed', 'x'))
        .mockResolvedValue({ job: createJob({ processedChats: 4 }) })

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 3)

      expect(backfill.isPaused.value).toBe(false)
      expect(backfill.isPolling.value).toBe(true)

      backfill.stopPolling()
    })

    it('resumes from the paused state when polling starts again', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockReset().mockRejectedValue(
        createRejection(500, 'Step failed', 'Model timed out'),
      )

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 6)

      expect(backfill.isPaused.value).toBe(true)

      mocks.fetch.mockReset().mockResolvedValue({
        job: createJob({ processedChats: 6 }),
      })

      backfill.startPolling()

      expect(backfill.isPaused.value).toBe(false)
      expect(backfill.pollError.value).toBeNull()
      expect(backfill.isPolling.value).toBe(true)

      await flushPromises()

      expect(callsTo(STEP_URL)).toHaveLength(1)
      expect(backfill.error.value).toBeNull()

      backfill.stopPolling()
    })

    it('clears the paused state when polling is stopped', async () => {
      mockRunningOverview()

      const backfill = useMemoryBackfill()

      await backfill.load()

      mocks.fetch.mockReset().mockRejectedValue(
        createRejection(500, 'Step failed', 'Model timed out'),
      )

      backfill.startPolling()
      await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 6)
      backfill.stopPolling()

      expect(backfill.isPaused.value).toBe(false)
      expect(backfill.pollError.value).toBeNull()
    })
  })
})
