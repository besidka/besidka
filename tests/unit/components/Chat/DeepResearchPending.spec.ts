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

  it('shows the running status, elapsed timer, and level + model', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    expect(
      wrapper.get('[data-testid="research-pending-status"]').text(),
    ).toContain('Researching…')
    expect(
      wrapper.get('[data-testid="research-pending-timer"]').text(),
    ).toBe('(1:05)')

    const levelText = wrapper.get('[data-testid="research-pending-level"]')
      .text()

    expect(levelText).toContain('o4-mini Deep Research')
    expect(levelText).toContain('Quick')
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

  it('shows a static telescope icon next to the status instead of a spinner', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 65_000,
      },
    })

    const statusRow = wrapper.get('[data-testid="research-pending-status"]')
      .element.parentElement

    expect(statusRow?.querySelector('svg')).toBeNull()

    const icon = statusRow?.querySelector('.iconify')

    expect(icon).not.toBeNull()
    expect(icon?.className).toContain('i-lucide:telescope')
    expect(icon?.className).toContain('size-4')
    expect(
      wrapper.find('[data-testid="research-pending-progress"]').exists(),
    ).toBe(true)
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

  it('emits cancel while running and never renders a step timeline', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'running' }),
        elapsedMs: 1000,
      },
    })

    expect(wrapper.text()).not.toContain('Step')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)

    await wrapper.get('[data-testid="research-cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
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

  it('shows a dismiss affordance and emits dismiss on cancelled', async () => {
    const wrapper = await mountSuspended(DeepResearchPending, {
      props: {
        job: createJob({ status: 'cancelled' }),
        elapsedMs: 0,
      },
    })

    expect(
      wrapper.find('[data-testid="research-pending-cancelled"]').exists(),
    ).toBe(true)
    expect(wrapper.find('[data-testid="research-cancel"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="research-dismiss"]').trigger('click')

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})
