import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillProgress,
  MemoryBackfillUnavailableReason,
} from '../../../../../../shared/types/memory-backfill.d'
import BackfillSheet from '../../../../../../app/components/Profile/Memory/Entries/BackfillSheet.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const BACKFILL_URL = '/api/v1/memory/backfill'
const STEP_URL = '/api/v1/memory/backfill/step'
const CANCEL_URL = '/api/v1/memory/backfill/cancel'

function createEstimate(
  overrides: Partial<MemoryBackfillEstimate> = {},
): MemoryBackfillEstimate {
  return {
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
    ...overrides,
  }
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
    processedChats: 12,
    createdEntries: 3,
    updatedEntries: 1,
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

function createFinishedJob(
  overrides: Partial<MemoryBackfillProgress> = {},
): MemoryBackfillProgress {
  return createJob({
    status: 'completed',
    finishedAt: new Date().toISOString(),
    processedChats: 48,
    createdEntries: 12,
    updatedEntries: 4,
    skippedChats: 4,
    failedChats: 1,
    inputTokens: 290_000,
    outputTokens: 39_000,
    ...overrides,
  })
}

function createRejection(statusCode: number, message: string, why: string) {
  return Object.assign(new Error('Request failed'), {
    data: { statusCode, message, data: { why } },
  })
}

interface ApiOptions {
  overview?: {
    job: MemoryBackfillProgress | null
    estimate: MemoryBackfillEstimate | null
    reason: MemoryBackfillUnavailableReason | null
  } | Error
  restartOverview?: {
    job: MemoryBackfillProgress | null
    estimate: MemoryBackfillEstimate | null
    reason: MemoryBackfillUnavailableReason | null
  }
  start?: MemoryBackfillProgress | Error
  step?: MemoryBackfillProgress | Error
  cancel?: MemoryBackfillProgress | null | Error
}

function mockApi(options: ApiOptions = {}) {
  mocks.fetch.mockImplementation(
    async (
      url: string,
      init?: { method?: string, query?: Record<string, string> },
    ) => {
      const isRestartLoad = init?.query?.restart === 'true'
        && !!options.restartOverview
      const response = {
        [BACKFILL_URL]: init?.method === 'POST'
          ? options.start ?? createJob({ processedChats: 0 })
          : isRestartLoad
            ? options.restartOverview
            : options.overview ?? {
              job: null,
              estimate: createEstimate(),
              reason: null,
            },
        [STEP_URL]: options.step ?? createJob(),
        [CANCEL_URL]: options.cancel === undefined
          ? createJob({ status: 'cancelled', finishedAt: 'x' })
          : options.cancel,
      }[url]

      if (response instanceof Error) {
        throw response
      }

      if (init?.method === 'POST') {
        return { job: response }
      }

      return response
    },
  )
}

function callsTo(url: string, method?: string) {
  return mocks.fetch.mock.calls.filter(([calledUrl, init]) => {
    return calledUrl === url && (!method || init?.method === method)
  })
}

async function mountSheet(options: ApiOptions = {}) {
  mockApi(options)

  const wrapper = await mountSuspended(BackfillSheet, {
    props: { open: false },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSheet>>

function byTestId(wrapper: Wrapper, testId: string) {
  return wrapper.get(`[data-testid="${testId}"]`)
}

function hasTestId(wrapper: Wrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function textOf(wrapper: Wrapper, testId: string): string {
  return byTestId(wrapper, testId).text().replace(/\s+/g, ' ')
}

function droppedOf(wrapper: Wrapper, reason: string): string {
  return byTestId(wrapper, `memory-backfill-dropped-${reason}`)
    .findAll('span')
    .map(span => span.text())
    .join(' ')
}

function isDisabled(wrapper: Wrapper, testId: string): boolean {
  return byTestId(wrapper, testId).classes().includes('btn-disabled')
}

describe('Profile/Memory/Entries/BackfillSheet', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Stop', index: 0 })
    mocks.error.mockReset()
    clearNuxtState('memory-backfill-overview')
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('dialog', () => {
    it('opens as an accessible modal dialog with js and test hooks',
      async () => {
        const wrapper = await mountSheet()
        const dialog = byTestId(wrapper, 'memory-backfill-modal')
        const headingId = dialog.attributes('aria-labelledby')!

        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
        expect(dialog.classes()).toEqual(expect.arrayContaining([
          'js-memory-backfill-modal',
          'modal',
          'modal-bottom',
          'sm:modal-middle',
        ]))
        expect(wrapper.get(`#${headingId}`).text())
          .toBe('Build memory from past chats')
      })

    it('keeps the cards on the box radius', async () => {
      const wrapper = await mountSheet()

      expect(byTestId(wrapper, 'memory-backfill-confirm')
        .html()).toContain('rounded-box')
      expect(byTestId(wrapper, 'memory-backfill-confirm')
        .html()).not.toContain('rounded-full')
    })

    it('closes from the header button and announces it', async () => {
      const wrapper = await mountSheet()

      await byTestId(wrapper, 'memory-backfill-close').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    })

    it('reloads every time it opens', async () => {
      const wrapper = await mountSheet()

      expect(callsTo(BACKFILL_URL, undefined)).toHaveLength(1)

      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(callsTo(BACKFILL_URL).length).toBe(2)
    })
  })

  describe('loading', () => {
    it('shows a skeleton until the overview arrives', async () => {
      let finishLoad: (value: unknown) => void = () => {}

      mocks.fetch.mockImplementation(() => {
        return new Promise((resolve) => {
          finishLoad = resolve
        })
      })

      const wrapper = await mountSuspended(BackfillSheet, {
        props: { open: false },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(hasTestId(wrapper, 'memory-backfill-loading')).toBe(true)
      expect(wrapper.find('.skeleton').exists()).toBe(true)
      expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(false)

      finishLoad({ job: null, estimate: createEstimate(), reason: null })
      await flushPromises()

      expect(hasTestId(wrapper, 'memory-backfill-loading')).toBe(false)
      expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(true)
    })
  })

  describe('unavailable', () => {
    it.each([
      ['memory-disabled', 'Turn on Use memory first.'],
      ['extraction-disabled', 'Turn on Generate memory from chats first.'],
      ['estimate-failed', 'Couldn\'t estimate the cost. Try again.'],
      [
        'estimate-cooldown',
        'The cost was estimated moments ago. Try again in half a minute.',
      ],
      [
        'all-chats-read',
        'The last run already read all your past chats. New chats are added '
        + 'to memory automatically. You can still read them all again from '
        + 'the newest.',
      ],
    ] as const)('explains %s and disables Start', async (reason, copy) => {
      const wrapper = await mountSheet({
        overview: { job: null, estimate: null, reason },
      })

      expect(textOf(wrapper, 'memory-backfill-unavailable-message'))
        .toBe(copy)
      expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(false)
      expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(true)
    })

    it.each([
      'memory-disabled',
      'extraction-disabled',
      'estimate-failed',
      'no-model',
    ] as const)('offers no restart for %s', async (reason) => {
      const wrapper = await mountSheet({
        overview: { job: null, estimate: null, reason },
      })

      expect(hasTestId(wrapper, 'memory-backfill-restart')).toBe(false)
    })

    describe('read all past chats again', () => {
      const allRead = {
        overview: {
          job: createFinishedJob(),
          estimate: null,
          reason: 'all-chats-read' as const,
        },
        restartOverview: {
          job: createFinishedJob(),
          estimate: createEstimate({ chats: 120 }),
          reason: null,
        },
      }

      it('shows the fresh-window estimate and starts nothing yet',
        async () => {
          const wrapper = await mountSheet(allRead)

          expect(textOf(wrapper, 'memory-backfill-restart'))
            .toBe('Read all past chats again')

          await byTestId(wrapper, 'memory-backfill-restart').trigger('click')
          await flushPromises()

          expect(mocks.fetch).toHaveBeenCalledWith(BACKFILL_URL, {
            query: { restart: 'true' },
          })
          expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(true)
          expect(textOf(wrapper, 'memory-backfill-estimate-chats'))
            .toBe('120 chats')
          expect(textOf(wrapper, 'memory-backfill-restart-note')).toBe(
            'Starts over from your newest chat and reads chats that earlier '
            + 'runs already read, so your API key is charged for them again.',
          )
          expect(textOf(wrapper, 'memory-backfill-limits-note')).toContain(
            `Reads at most your ${MEMORY_LIMITS.backfillMaxChats} most recent `
            + 'account chats.',
          )
          expect(textOf(wrapper, 'memory-backfill-start')).toBe('Read again')
          expect(callsTo(BACKFILL_URL, 'POST')).toHaveLength(0)
        })

      it('starts the restart only on confirm', async () => {
        const wrapper = await mountSheet(allRead)

        await byTestId(wrapper, 'memory-backfill-restart').trigger('click')
        await flushPromises()
        await byTestId(wrapper, 'memory-backfill-start').trigger('click')
        await flushPromises()

        expect(callsTo(BACKFILL_URL, 'POST')).toEqual([[
          BACKFILL_URL,
          { method: 'POST', body: { restart: true } },
        ]])
      })

      it('forgets the restart offer when the sheet is reopened', async () => {
        const wrapper = await mountSheet(allRead)

        await byTestId(wrapper, 'memory-backfill-restart').trigger('click')
        await flushPromises()
        await wrapper.setProps({ open: false })
        await flushPromises()
        await wrapper.setProps({ open: true })
        await flushPromises()

        expect(mocks.fetch).toHaveBeenLastCalledWith(BACKFILL_URL, {
          query: {},
        })
        expect(hasTestId(wrapper, 'memory-backfill-restart')).toBe(true)
        expect(hasTestId(wrapper, 'memory-backfill-restart-note')).toBe(false)
      })
    })

    it('points to the API keys page when no model is available',
      async () => {
        const wrapper = await mountSheet({
          overview: { job: null, estimate: null, reason: 'no-model' },
        })
        const link = byTestId(wrapper, 'memory-backfill-keys-link')

        expect(textOf(wrapper, 'memory-backfill-unavailable-message'))
          .toBe(
            'No model with an API key is available for memory. Add a key in '
            + 'Profile > API Keys or pick a model under Models for memory.',
          )
        expect(link.attributes('href') ?? link.attributes('to'))
          .toBe('/profile/keys')
        expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(true)
        expect(hasTestId(wrapper, 'memory-backfill-retry')).toBe(false)
      })

    it.each(['estimate-failed', 'estimate-cooldown'] as const)(
      'offers Try again for %s and reloads', async (reason) => {
        const wrapper = await mountSheet({
          overview: { job: null, estimate: null, reason },
        })

        expect(hasTestId(wrapper, 'memory-backfill-retry')).toBe(true)

        mockApi()
        await byTestId(wrapper, 'memory-backfill-retry').trigger('click')
        await flushPromises()

        expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(true)
        expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(false)
      })

    it('treats a failed overview request as a failed estimate', async () => {
      const wrapper = await mountSheet({
        overview: createRejection(500, 'Could not read', 'D1 is down'),
      })

      expect(textOf(wrapper, 'memory-backfill-unavailable-message'))
        .toBe('Couldn\'t estimate the cost. Try again.')
      expect(hasTestId(wrapper, 'memory-backfill-retry')).toBe(true)
    })
  })

  describe('confirm', () => {
    it('shows the estimate, the model and the scope note', async () => {
      const wrapper = await mountSheet()

      expect(textOf(wrapper, 'memory-backfill-estimate-chats'))
        .toBe('48 chats')
      expect(textOf(wrapper, 'memory-backfill-estimate-tokens')).toBe(
        'about 310K input tokens and 42K output tokens',
      )
      expect(textOf(wrapper, 'memory-backfill-estimate-cost'))
        .toBe('Approximately $0.52')
      expect(textOf(wrapper, 'memory-backfill-estimate-model'))
        .toBe('GPT-5 mini (your chosen memory model)')
      expect(textOf(wrapper, 'memory-backfill-estimate-note')).toContain(
        'Models with tiered or "from" prices may cost more than shown.',
      )
      expect(textOf(wrapper, 'memory-backfill-scope-note')).toBe(
        'Runs on your own API key. Reads your account chats (not projects) '
        + 'and may take several minutes.',
      )
      expect(textOf(wrapper, 'memory-backfill-limits-note')).toBe(
        `Reads at most your ${MEMORY_LIMITS.backfillMaxChats} most recent `
        + 'account chats. Stops after '
        + `${MEMORY_LIMITS.backfillMaxTokens / 1_000_000} million tokens in `
        + 'total, even if the cost could not be estimated.',
      )
      expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(false)
      expect(hasTestId(wrapper, 'memory-backfill-last-run')).toBe(false)
    })

    it('describes a continuation as the next older chats', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({ chats: 3, continuesPreviousRun: true }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-chats'))
        .toBe('next 3 older chats')
      expect(textOf(wrapper, 'memory-backfill-limits-note')).toBe(
        'Continues where the last run stopped and reads at most the next '
        + `${MEMORY_LIMITS.backfillMaxChats} older account chats. Stops after `
        + `${MEMORY_LIMITS.backfillMaxTokens / 1_000_000} million tokens in `
        + 'total, even if the cost could not be estimated.',
      )
      expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(false)
    })

    it.each([
      ['setting', 'your chosen memory model'],
      ['chat', 'same as chat'],
      ['fallback', 'fallback'],
    ] as const)('labels the %s model source', async (source, label) => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({
            model: {
              source,
              providerId: 'openai',
              gatewayId: null,
              modelId: 'gpt-5-mini',
              modelName: 'GPT-5 mini',
            },
          }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-model'))
        .toBe(`GPT-5 mini (${label})`)
    })

    it('says the price is unknown when the cost is null', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({ costUsd: null, pricePerMillion: null }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-cost')).toBe(
        'Price unknown for this model, so the cost can\'t be estimated.',
      )
      expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(false)
    })

    it('shows a tiny cost as less than one cent', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({ costUsd: 0.004 }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-cost'))
        .toBe('Approximately < $0.01')
    })

    it('reads naturally when the estimated cost is exactly zero', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({ costUsd: 0 }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-cost'))
        .toBe('About $0.00')
    })

    it('uses the singular for one chat', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: null,
          estimate: createEstimate({ chats: 1 }),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-estimate-chats'))
        .toBe('1 chat')
    })

    it('says there is nothing to read and disables Start for zero chats',
      async () => {
        const wrapper = await mountSheet({
          overview: {
            job: null,
            estimate: createEstimate({ chats: 0, costUsd: 0 }),
            reason: null,
          },
        })

        expect(textOf(wrapper, 'memory-backfill-empty'))
          .toBe('There are no chats to read.')
        expect(hasTestId(wrapper, 'memory-backfill-estimate-chats'))
          .toBe(false)
        expect(isDisabled(wrapper, 'memory-backfill-start')).toBe(true)
      })

    it('shows the last finished run', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: createFinishedJob({ createdEntries: 12 }),
          estimate: createEstimate(),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-last-run')).toBe(
        'Last run: completed just now, 12 entries created.',
      )
      expect(hasTestId(wrapper, 'memory-backfill-summary')).toBe(false)
    })

    it('uses the singular entry in the last run line', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: createFinishedJob({
            status: 'cancelled',
            createdEntries: 1,
          }),
          estimate: createEstimate(),
          reason: null,
        },
      })

      expect(textOf(wrapper, 'memory-backfill-last-run')).toBe(
        'Last run: cancelled just now, 1 entry created.',
      )
    })

    it('closes without starting from Cancel', async () => {
      const wrapper = await mountSheet()

      await byTestId(wrapper, 'memory-backfill-dismiss').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
      expect(callsTo(BACKFILL_URL, 'POST')).toHaveLength(0)
    })
  })

  describe('start and running', () => {
    it('starts the job and switches to the running view', async () => {
      const wrapper = await mountSheet({
        start: createJob({ processedChats: 0, createdEntries: 0 }),
      })

      await byTestId(wrapper, 'memory-backfill-start').trigger('click')
      await flushPromises()

      expect(callsTo(BACKFILL_URL, 'POST')).toHaveLength(1)
      expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(true)
      expect(hasTestId(wrapper, 'memory-backfill-confirm')).toBe(false)
    })

    it('drives a step as soon as the job is running', async () => {
      const wrapper = await mountSheet()

      await byTestId(wrapper, 'memory-backfill-start').trigger('click')
      await flushPromises()

      expect(callsTo(STEP_URL, 'POST')).toHaveLength(1)
    })

    it('shows a toast when starting is refused', async () => {
      const wrapper = await mountSheet({
        start: createRejection(
          409,
          'Memory generation is off',
          'Turn on Generate memory from chats.',
        ),
      })

      await byTestId(wrapper, 'memory-backfill-start').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Memory generation is off',
        'Turn on Generate memory from chats.',
      )
      expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(false)
    })

    it('shows the progress bar and counters of a running job', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: createJob({
            processedChats: 12,
            totalChats: 48,
            createdEntries: 3,
            updatedEntries: 1,
          }),
          estimate: null,
          reason: null,
        },
      })
      const progress = byTestId(wrapper, 'memory-backfill-progress')

      expect(textOf(wrapper, 'memory-backfill-progress-text'))
        .toBe('12 / 48 chats')
      expect(progress.element.tagName).toBe('PROGRESS')
      expect(progress.classes()).toContain('progress')
      expect(progress.attributes('aria-valuenow')).toBe('12')
      expect(progress.attributes('aria-valuemax')).toBe('48')
      expect(progress.attributes('value')).toBe('12')
      expect(textOf(wrapper, 'memory-backfill-created')).toBe('3')
      expect(textOf(wrapper, 'memory-backfill-updated')).toBe('1')
      expect(textOf(wrapper, 'memory-backfill-background-note')).toBe(
        'You can close this sheet. It keeps going in the background where '
        + 'scheduled jobs run, and while this sheet is open on previews.',
      )
    })

    it('shows a step error under the progress without hiding it',
      async () => {
        const wrapper = await mountSheet({
          overview: {
            job: createJob(),
            estimate: null,
            reason: null,
          },
          step: createRejection(500, 'Step failed', 'Model timed out'),
        })

        expect(textOf(wrapper, 'memory-backfill-error'))
          .toBe('Step failed Model timed out')
        expect(hasTestId(wrapper, 'memory-backfill-progress')).toBe(true)
      })

    it('resumes a job that is already running when opened', async () => {
      const wrapper = await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
      })

      expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(true)
      expect(callsTo(STEP_URL, 'POST')).toHaveLength(1)
    })
  })

  describe('stop', () => {
    async function mountRunning(options: ApiOptions = {}) {
      return await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
        ...options,
      })
    }

    it('asks for confirmation before stopping', async () => {
      const wrapper = await mountRunning()

      await byTestId(wrapper, 'memory-backfill-cancel').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Stop building memory?',
        subtitle: 'Entries already added are kept. You can start again later.',
        actions: ['Stop'],
        labelDecline: 'Keep going',
      })
    })

    it('keeps running when the confirmation is declined', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountRunning()

      await byTestId(wrapper, 'memory-backfill-cancel').trigger('click')
      await flushPromises()

      expect(callsTo(CANCEL_URL)).toHaveLength(0)
      expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(true)
    })

    it('cancels and shows the stopped summary when confirmed', async () => {
      const wrapper = await mountRunning({
        cancel: createJob({
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
        }),
      })

      await byTestId(wrapper, 'memory-backfill-cancel').trigger('click')
      await flushPromises()

      expect(callsTo(CANCEL_URL, 'POST')).toHaveLength(1)
      expect(textOf(wrapper, 'memory-backfill-summary-title'))
        .toBe('Stopped. Entries added so far are kept.')
      expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(false)
    })

    it('toasts when stopping fails and stays on the running view',
      async () => {
        const wrapper = await mountRunning({
          cancel: createRejection(500, 'Could not stop', 'D1 is down'),
        })

        await byTestId(wrapper, 'memory-backfill-cancel').trigger('click')
        await flushPromises()

        expect(mocks.error).toHaveBeenCalledWith(
          'Could not stop',
          'D1 is down',
        )
        expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(true)
      })
  })

  describe('summary', () => {
    async function finishRun(job: MemoryBackfillProgress) {
      const wrapper = await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
        step: job,
      })

      return wrapper
    }

    it('summarises a completed run with counts, dropped reasons and tokens',
      async () => {
        const wrapper = await finishRun(createFinishedJob({
          dropped: {
            'sensitive-topic': 3,
            'never-store': 2,
            'duplicate': 9,
            'ungrounded': 4,
            'weird-reason': 1,
          },
        }))

        expect(textOf(wrapper, 'memory-backfill-summary-title'))
          .toBe('Memory built from your past chats.')
        expect(textOf(wrapper, 'memory-backfill-created')).toBe('12')
        expect(textOf(wrapper, 'memory-backfill-updated')).toBe('4')
        expect(textOf(wrapper, 'memory-backfill-skipped')).toBe('4')
        expect(textOf(wrapper, 'memory-backfill-failed')).toBe('1')
        expect(textOf(wrapper, 'memory-backfill-summary-progress'))
          .toBe('Read 48 of 48 chats.')
        expect(droppedOf(wrapper, 'sensitive-topic'))
          .toBe('Sensitive topics (never saved) 3')
        expect(droppedOf(wrapper, 'never-store'))
          .toBe('Private data (never saved) 2')
        expect(droppedOf(wrapper, 'duplicate'))
          .toBe('Already remembered 9')
        expect(droppedOf(wrapper, 'ungrounded'))
          .toBe('No supporting quote 4')
        expect(droppedOf(wrapper, 'weird-reason'))
          .toBe('weird-reason 1')
        expect(textOf(wrapper, 'memory-backfill-tokens-used'))
          .toBe('Used about 290K input and 39K output tokens.')
        expect(hasTestId(wrapper, 'memory-backfill-failure')).toBe(false)
        expect(hasTestId(wrapper, 'memory-backfill-done')).toBe(true)
        expect(hasTestId(wrapper, 'memory-backfill-start')).toBe(false)
      })

    it('lists the dropped reasons from most to least frequent', async () => {
      const wrapper = await finishRun(createFinishedJob({
        dropped: { 'ungrounded': 1, 'duplicate': 9, 'never-store': 4 },
      }))
      const reasons = wrapper
        .findAll('[data-testid^="memory-backfill-dropped-"]')
        .map(item => item.attributes('data-testid'))

      expect(reasons).toEqual([
        'memory-backfill-dropped-duplicate',
        'memory-backfill-dropped-never-store',
        'memory-backfill-dropped-ungrounded',
      ])
    })

    it('omits the dropped block when nothing was dropped', async () => {
      const wrapper = await finishRun(createFinishedJob({ dropped: {} }))

      expect(hasTestId(wrapper, 'memory-backfill-dropped')).toBe(false)
    })

    it('summarises a cancelled run', async () => {
      const wrapper = await finishRun(createFinishedJob({
        status: 'cancelled',
        processedChats: 20,
      }))

      expect(textOf(wrapper, 'memory-backfill-summary-title'))
        .toBe('Stopped. Entries added so far are kept.')
      expect(textOf(wrapper, 'memory-backfill-summary-progress'))
        .toBe('Read 20 of 48 chats.')
    })

    it.each([
      ['model-unavailable', 'The model became unavailable.'],
      [
        'spend-limit',
        'Stopped at the spend limit: 1.5 times the estimate or '
        + `${MEMORY_LIMITS.backfillMaxTokens / 1_000_000} million tokens.`,
      ],
      ['too-many-failures', 'Too many chats failed.'],
      ['consecutive-failures', 'Several chats in a row failed.'],
    ] as const)('explains the %s failure', async (failureReason, copy) => {
      const wrapper = await finishRun(createFinishedJob({
        status: 'failed',
        failureReason,
      }))

      expect(textOf(wrapper, 'memory-backfill-summary-title'))
        .toBe('Stopped early. Entries added so far are kept.')
      expect(textOf(wrapper, 'memory-backfill-failure')).toBe(copy)
      expect(byTestId(wrapper, 'memory-backfill-failure').attributes('role'))
        .toBe('alert')
    })

    it('closes from Done', async () => {
      const wrapper = await finishRun(createFinishedJob())

      await byTestId(wrapper, 'memory-backfill-done').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    })
  })

  describe('changed', () => {
    it('emits once when a run completes with new entries', async () => {
      const wrapper = await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
        step: createFinishedJob({ createdEntries: 12, updatedEntries: 4 }),
      })

      expect(wrapper.emitted('changed')).toHaveLength(1)

      await wrapper.setProps({ open: false })
      await flushPromises()

      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('stays quiet when a run completes without any entries', async () => {
      const wrapper = await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
        step: createFinishedJob({ createdEntries: 0, updatedEntries: 0 }),
      })

      await wrapper.setProps({ open: false })
      await flushPromises()

      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('emits on close when entries were added to a running job',
      async () => {
        const wrapper = await mountSheet({
          overview: {
            job: createJob({ createdEntries: 5, updatedEntries: 2 }),
            estimate: null,
            reason: null,
          },
          step: createJob({ createdEntries: 5, updatedEntries: 2 }),
        })

        expect(wrapper.emitted('changed')).toBeUndefined()

        await wrapper.setProps({ open: false })
        await flushPromises()

        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('stays quiet when an idle sheet is closed', async () => {
      const wrapper = await mountSheet({
        overview: {
          job: createFinishedJob(),
          estimate: createEstimate(),
          reason: null,
        },
      })

      await wrapper.setProps({ open: false })
      await flushPromises()

      expect(wrapper.emitted('changed')).toBeUndefined()
    })
  })

  describe('paused after repeated errors', () => {
    const PAUSE_COPY = 'Progress paused after repeated errors. Try again.'

    async function mountPaused() {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

      const wrapper = await mountSheet({
        overview: { job: createJob(), estimate: null, reason: null },
        step: createRejection(500, 'Step failed', 'Model timed out'),
      })

      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()

      return wrapper
    }

    it('shows the pause copy and a Try again button after three failures',
      async () => {
        try {
          const wrapper = await mountPaused()

          expect(callsTo(STEP_URL, 'POST')).toHaveLength(3)
          expect(hasTestId(wrapper, 'memory-backfill-running')).toBe(true)
          expect(textOf(wrapper, 'memory-backfill-paused-message'))
            .toBe(PAUSE_COPY)
          expect(textOf(wrapper, 'memory-backfill-resume'))
            .toContain('Try again')
        } finally {
          vi.useRealTimers()
        }
      })

    it('does not show the pause state while steps are still running',
      async () => {
        const wrapper = await mountSheet({
          overview: { job: createJob(), estimate: null, reason: null },
        })

        expect(hasTestId(wrapper, 'memory-backfill-paused')).toBe(false)
        expect(hasTestId(wrapper, 'memory-backfill-resume')).toBe(false)
      })

    it('drives steps again and hides the pause state on Try again',
      async () => {
        try {
          const wrapper = await mountPaused()

          mockApi({
            overview: { job: createJob(), estimate: null, reason: null },
            step: createJob({ processedChats: 14 }),
          })

          await byTestId(wrapper, 'memory-backfill-resume').trigger('click')
          await flushPromises()

          expect(callsTo(STEP_URL, 'POST')).toHaveLength(4)
          expect(hasTestId(wrapper, 'memory-backfill-paused')).toBe(false)
          expect(hasTestId(wrapper, 'memory-backfill-error')).toBe(false)
          expect(textOf(wrapper, 'memory-backfill-progress-text'))
            .toBe('14 / 48 chats')
        } finally {
          vi.useRealTimers()
        }
      })
  })

  describe('polling lifecycle', () => {
    it('stops driving steps once the sheet is closed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

      try {
        const wrapper = await mountSheet({
          overview: { job: createJob(), estimate: null, reason: null },
        })

        expect(callsTo(STEP_URL, 'POST')).toHaveLength(1)

        await wrapper.setProps({ open: false })
        await flushPromises()
        await vi.advanceTimersByTimeAsync(60_000)

        expect(callsTo(STEP_URL, 'POST')).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps driving steps while the sheet stays open', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

      try {
        await mountSheet({
          overview: { job: createJob(), estimate: null, reason: null },
        })
        await vi.advanceTimersByTimeAsync(10_500)

        expect(callsTo(STEP_URL, 'POST').length).toBeGreaterThanOrEqual(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
