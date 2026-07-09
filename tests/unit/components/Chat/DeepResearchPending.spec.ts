import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ResearchJobView } from '#shared/types/research.d'
import DeepResearchPending from '../../../../app/components/Chat/DeepResearchPending.vue'

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

  it('emits cancel while running and hides the current-step section when no step is provided', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 1000,
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

  it('shows the current research step with a parsed title and description', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        currentStep: {
          kind: 'thought',
          text: '**Assessing options** Comparing the top candidates'
            + ' in detail.',
        },
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')

    expect(step.text()).toContain('Assessing options')
    expect(step.text()).toContain('Comparing the top candidates in detail.')
    expect(step.get('.iconify').classes()).toContain('i-lucide:brain')
  })

  it('applies the blinking skeleton treatment to the current step title', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        currentStep: { kind: 'search', text: 'best espresso machines 2026' },
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')

    expect(step.find('.research-step-title-skeleton').exists()).toBe(true)
    expect(step.get('.iconify').classes()).toContain('i-lucide:search')
  })

  it('renders the read current step as a plain (non-clickable) label', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 5_000,
        currentStep: {
          kind: 'read',
          text: 'https://example.com/research/crdt-maturity',
        },
      },
    })

    const step = wrapper.get('[data-testid="research-current-step"]')

    expect(step.get('.iconify').classes()).toContain('i-lucide:link')
    expect(step.find('button').exists()).toBe(false)
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
        currentStep: { kind: 'search', text: 'best espresso machines 2026' },
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
