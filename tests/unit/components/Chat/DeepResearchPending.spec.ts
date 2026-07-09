import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchJobView } from '#shared/types/research.d'
import DeepResearchPending from '../../../../app/components/Chat/DeepResearchPending.vue'

const useConfirmMock = vi.hoisted(() => {
  return vi.fn<() => Promise<{ label: string, index: number } | null>>(
    async () => null,
  )
})

mockNuxtImport('useConfirm', () => {
  return useConfirmMock
})

function createJob(
  overrides: Partial<ResearchJobView> = {},
): ResearchJobView {
  return {
    publicId: 'job-1',
    status: 'running',
    provider: 'openai',
    level: 'quick',
    modelId: 'o4-mini-deep-research',
    startedAt: Date.now(),
    error: null,
    resultMessageId: null,
    ...overrides,
  }
}

describe('Chat/DeepResearchPending', () => {
  it('shows the pending status before a job starts running', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'pending' }),
        elapsedMs: 0,
      },
    })

    expect(
      wrapper.get('[data-testid="research-pending-status"]').text(),
    ).toBe('Preparing your research…')
    expect(
      wrapper.find('[data-testid="research-pending-timer"]').exists(),
    ).toBe(false)
  })

  it('hides the timer while the job has not started yet', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'pending', startedAt: null }),
        elapsedMs: 0,
      },
    })

    expect(
      wrapper.find('[data-testid="research-pending-timer"]').exists(),
    ).toBe(false)
  })

  it('shows the running status, elapsed timer, and model + tier in the merged header', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    const status = wrapper.get('[data-testid="research-pending-status"]')

    expect(status.text()).toContain('Researching with')
    expect(status.text()).toContain('o4-mini Deep Research')
    expect(status.text()).toContain('Quick')
    expect(
      wrapper.get('[data-testid="research-pending-timer"]').text(),
    ).toBe('(1:05)')
  })

  it('renders an indeterminate progress bar while not terminal', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    const progress = wrapper.get('[data-testid="research-pending-progress"]')

    expect(progress.attributes('value')).toBeUndefined()
  })

  it('shows the OpenAI provider logo next to the status instead of a spinner', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    const statusRow = wrapper.get('[data-testid="research-pending-status"]')
      .element.parentElement
    const logo = statusRow?.querySelector('svg')

    expect(logo).not.toBeNull()
    expect(logo?.getAttribute('viewBox')).toBe('0 0 256 260')
    expect(
      wrapper.find('[data-testid="research-pending-progress"]').exists(),
    ).toBe(true)
  })

  it('shows the Gemini provider logo for a google job', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running', provider: 'google' }),
        elapsedMs: 65_000,
      },
    })

    const statusRow = wrapper.get('[data-testid="research-pending-status"]')
      .element.parentElement
    const logo = statusRow?.querySelector('svg')

    expect(logo).not.toBeNull()
    expect(logo?.getAttribute('viewBox')).toBe('0 0 50 50')
  })

  it('does not render the progress bar in a terminal state', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'cancelled' }),
        elapsedMs: 0,
      },
    })

    expect(
      wrapper.find('[data-testid="research-pending-progress"]').exists(),
    ).toBe(false)
  })

  it('shows the time estimate pulled from the model research config', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({
          status: 'running',
          modelId: 'o3-deep-research',
          level: 'thorough',
        }),
        elapsedMs: 0,
      },
    })

    expect(wrapper.text()).toContain('10–30 min')
  })

  it('renders the alert-info expectation before the progress bar', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    const expectation = wrapper.get(
      '[data-testid="research-pending-expectation"]',
    )
    const progress = wrapper.get('[data-testid="research-pending-progress"]')
    const position = expectation.element.compareDocumentPosition(
      progress.element,
    )

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('emits cancel while running and hides the current-step section when no steps are provided', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 1000,
        recentSteps: [],
      },
    })

    expect(wrapper.text()).not.toContain('Step')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
    expect(
      wrapper.find('[data-testid="research-current-step"]').exists(),
    ).toBe(false)

    await wrapper.get('[data-testid="research-cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('shows the newest research step with a parsed title and description', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          {
            kind: 'thought',
            text: '**Assessing options** Comparing the top candidates'
              + ' in detail.',
          },
        ],
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')

    expect(step.text()).toContain('Assessing options')
    expect(step.text()).toContain('Comparing the top candidates in detail.')
    expect(step.get('.iconify').classes()).toContain('i-lucide:brain')
  })

  it('applies the blinking skeleton treatment to the newest step title', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          { kind: 'search', text: 'best espresso machines 2026' },
        ],
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')

    expect(step.find('.research-step-title-skeleton').exists()).toBe(true)
    expect(step.get('.iconify').classes()).toContain('i-lucide:search')
  })

  it('renders the rolling window oldest to newest, dimming older steps', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          { kind: 'thought', text: 'First thought.' },
          { kind: 'search', text: 'second search query' },
          { kind: 'thought', text: 'Newest thought.' },
        ],
      },
    })

    const rows = wrapper.findAll('[data-testid="research-recent-step"]')

    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('First thought.')
    expect(rows[1]?.text()).toContain('second search query')
    expect(rows[2]?.text()).toContain('Newest thought.')

    expect(rows[0]?.get('div').classes()).toContain('opacity-50')
    expect(rows[1]?.get('div').classes()).toContain('opacity-50')
    expect(rows[2]?.get('div').classes()).not.toContain('opacity-50')

    expect(rows[0]?.find('.research-step-title-skeleton').exists())
      .toBe(false)
    expect(rows[1]?.find('.research-step-title-skeleton').exists())
      .toBe(false)
    expect(rows[2]?.find('.research-step-title-skeleton').exists())
      .toBe(true)
  })

  it('drops the oldest step from the window once a 4th distinct step arrives', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          { kind: 'search', text: 'second query' },
          { kind: 'read', text: 'https://example.com/third' },
          { kind: 'thought', text: 'Fourth thought.' },
        ],
      },
    })

    const rows = wrapper.findAll('[data-testid="research-recent-step"]')

    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).not.toContain('First thought.')
    expect(rows[2]?.text()).toContain('Fourth thought.')
  })

  it('renders the newest read step as a clickable button that opens via the confirm flow', async () => {
    useConfirmMock.mockReset().mockResolvedValue({ label: 'Open', index: 0 })

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          {
            kind: 'read',
            text: 'https://example.com/research/crdt-maturity',
          },
        ],
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')
    const link = step.get('[data-testid="research-current-step-link"]')

    expect(link.element.tagName).toBe('BUTTON')
    expect(step.get('.iconify').classes()).toContain('i-lucide:link')
    expect(link.text()).toBe('example.com')
    expect(step.find('.research-step-title-skeleton').exists()).toBe(true)

    await link.trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(useConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Open example.com?',
    }))
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/research/crdt-maturity',
      '_blank',
      'noopener,noreferrer',
    )

    windowOpen.mockRestore()
  })

  it('dims an older read step but keeps it clickable', async () => {
    useConfirmMock.mockReset().mockResolvedValue(null)

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        recentSteps: [
          { kind: 'read', text: 'https://example.com/older-read' },
          { kind: 'thought', text: 'Newest thought.' },
        ],
      },
    })

    const rows = wrapper.findAll('[data-testid="research-recent-step"]')
    const olderRow = rows[0]?.get('div')
    const olderLink = rows[0]?.get('[data-testid="research-current-step-link"]')

    expect(olderRow?.classes()).toContain('opacity-50')
    expect(olderRow?.classes()).toContain('hover:opacity-100')

    await olderLink?.trigger('click')
    await new Promise(resolve => setTimeout(resolve))

    expect(useConfirmMock).toHaveBeenCalled()

    windowOpen.mockRestore()
  })

  it('renders the error state with message, why, and fix', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({
          status: 'failed',
          error: {
            code: 'provider-unavailable',
            message: 'Research failed',
            why: 'The provider timed out.',
            fix: 'Try again in a few minutes.',
          },
        }),
        elapsedMs: 30_000,
      },
    })

    const errorBlock = wrapper.get('[data-testid="research-pending-error"]')

    expect(errorBlock.text()).toContain('Research failed')
    expect(errorBlock.text()).toContain('The provider timed out.')
    expect(errorBlock.text()).toContain('Try again in a few minutes.')
    expect(wrapper.find('[data-testid="research-cancel"]').exists())
      .toBe(false)
  })

  it('emits retry from the failed state', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({
          status: 'failed',
          error: { code: 'unknown', message: 'Research failed' },
        }),
        elapsedMs: 0,
      },
    })

    await wrapper.get('[data-testid="research-retry"]').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('shows a neutral checking status and hides progress, expectation, current step, and cancel', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
        checking: true,
        recentSteps: [
          { kind: 'search', text: 'best espresso machines 2026' },
        ],
      },
    })

    expect(
      wrapper.get('[data-testid="research-pending-status"]').text(),
    ).toBe('Checking research status…')
    expect(
      wrapper.find('[data-testid="research-pending-timer"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="research-pending-progress"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="research-pending-expectation"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="research-current-step"]').exists(),
    ).toBe(false)
    expect(wrapper.find('[data-testid="research-cancel"]').exists())
      .toBe(false)
    expect(wrapper.text()).not.toContain('This can take')
  })

  it('shows the merged header, progress, and expectation box once checking clears', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
        checking: false,
      },
    })

    const status = wrapper.get('[data-testid="research-pending-status"]')

    expect(status.text()).toContain('Researching with')
    expect(status.text()).toContain('o4-mini Deep Research')
    expect(status.text()).toContain('Quick')
    expect(
      wrapper.find('[data-testid="research-pending-progress"]').exists(),
    ).toBe(true)

    const expectation = wrapper.get(
      '[data-testid="research-pending-expectation"]',
    )

    expect(expectation.classes()).toContain('alert-info')
    expect(expectation.classes()).toContain('alert-soft')
    expect(wrapper.find('[data-testid="research-cancel"]').exists())
      .toBe(true)
  })

  it('shows cancelled text with no buttons at all', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'cancelled' }),
        elapsedMs: 0,
      },
    })

    const cancelledBlock = wrapper.get(
      '[data-testid="research-pending-cancelled"]',
    )

    expect(cancelledBlock.text()).toBe('Research cancelled by user')
    expect(wrapper.find('[data-testid="research-cancel"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="research-dismiss"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="research-retry"]').exists())
      .toBe(false)
  })

  it('keeps dismiss and retry on the failed state', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({
          status: 'failed',
          error: { code: 'unknown', message: 'Research failed' },
        }),
        elapsedMs: 0,
      },
    })

    expect(wrapper.find('[data-testid="research-dismiss"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="research-retry"]').exists())
      .toBe(true)

    await wrapper.get('[data-testid="research-dismiss"]').trigger('click')

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})
