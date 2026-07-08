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
    ).toBe('Researching…')
    expect(
      wrapper.get('[data-testid="research-pending-timer"]').text(),
    ).toBe('1:05')
    expect(
      wrapper.get('[data-testid="research-pending-level"]').text(),
    ).toContain('o4-mini-deep-research')
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
