import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { VueWrapper } from '@vue/test-utils'
import DeepResearchProgress from '../../../../app/components/Chat/DeepResearchProgress.vue'

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function researchStepPart(
  phase: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'data-research-step',
    id: `research-step-${phase}`,
    data: {
      phase,
      label: `Label for ${phase}`,
      status: 'active',
      ...overrides,
    },
  }
}

function timerLabel(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="research-timer-label"]').text()
}

async function mountAndStartResearch(
  turnStartedAt: number,
): Promise<VueWrapper> {
  const wrapper = await mountSuspended(DeepResearchProgress, {
    props: {
      message: createMessage([]),
      status: 'streaming',
      turnStartedAt,
    },
  })

  await wrapper.setProps({
    message: createMessage([
      researchStepPart('planning', {
        label: 'Planned the approach',
        status: 'done',
      }),
    ]),
  })
  await wrapper.vm.$nextTick()

  return wrapper
}

describe('Chat/DeepResearchProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing without research parts', async () => {
    const wrapper = await mountSuspended(DeepResearchProgress, {
      props: {
        message: createMessage([]),
        status: 'ready',
        turnStartedAt: Date.now(),
      },
    })

    expect(wrapper.find('.collapse').exists()).toBe(false)
  })

  it('collapses repeated step parts for the same phase to the latest value', async () => {
    const wrapper = await mountSuspended(DeepResearchProgress, {
      props: {
        message: createMessage([
          researchStepPart('planning', {
            label: 'Planned the approach',
            status: 'done',
          }),
          researchStepPart('searching', {
            label: 'Searching the web',
            count: 1,
          }),
          researchStepPart('searching', {
            label: 'Searching the web',
            count: 2,
          }),
          researchStepPart('searching', {
            label: 'Searching the web',
            count: 3,
          }),
          researchStepPart('reading', {
            label: 'Reading sources',
            count: 1,
          }),
        ]),
        status: 'streaming',
        turnStartedAt: Date.now(),
      },
    })

    const milestoneItems = wrapper.findAll('ul.timeline > li')

    expect(milestoneItems).toHaveLength(3)

    const searchingItem = milestoneItems.find((item) => {
      return item.text().includes('Searching the web')
    })

    expect(searchingItem?.text()).toContain('3')
  })

  it('orders milestones by phase regardless of part order', async () => {
    const wrapper = await mountSuspended(DeepResearchProgress, {
      props: {
        message: createMessage([
          researchStepPart('reading', { label: 'Reading sources' }),
          researchStepPart('planning', {
            label: 'Planned the approach',
            status: 'done',
          }),
          researchStepPart('searching', { label: 'Searching the web' }),
        ]),
        status: 'streaming',
        turnStartedAt: Date.now(),
      },
    })

    const milestoneLabels = wrapper.findAll('ul.timeline > li').map((item) => {
      return item.text()
    })

    expect(milestoneLabels[0]).toContain('Planned the approach')
    expect(milestoneLabels[1]).toContain('Searching the web')
    expect(milestoneLabels[2]).toContain('Reading sources')
  })

  it('shows the research brief topic and depth', async () => {
    const wrapper = await mountSuspended(DeepResearchProgress, {
      props: {
        message: createMessage([
          researchStepPart('planning', {
            label: 'Planned the approach',
            status: 'done',
          }),
          {
            type: 'data-research-brief',
            data: {
              topic: 'renewable energy adoption',
              depth: 'thorough',
              answers: [],
            },
          },
        ]),
        status: 'ready',
        turnStartedAt: Date.now(),
      },
    })

    expect(wrapper.text()).toContain('renewable energy adoption')
    expect(wrapper.text()).toContain('thorough')
  })

  it('shows 1s immediately once research starts streaming', async () => {
    const wrapper = await mountAndStartResearch(Date.now())

    expect(timerLabel(wrapper)).toBe('(1s)')
  })

  it('shows the real elapsed time immediately on a fresh mount when the turn already started earlier', async () => {
    const turnStartedAt = Date.now() - 12_000

    const wrapper = await mountSuspended(DeepResearchProgress, {
      props: {
        message: createMessage([
          researchStepPart('planning', {
            label: 'Planned the approach',
            status: 'done',
          }),
        ]),
        status: 'streaming',
        turnStartedAt,
      },
    })

    expect(timerLabel(wrapper)).toBe('(12s)')
  })

  it('reports the real duration once the final report text lands', async () => {
    const wrapper = await mountAndStartResearch(Date.now())

    vi.setSystemTime(Date.now() + 9000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({
      message: createMessage([
        researchStepPart('planning', {
          label: 'Planned the approach',
          status: 'done',
        }),
        researchStepPart('synthesizing', {
          label: 'Writing the report',
          status: 'done',
        }),
        { type: 'text', text: 'Final report body' },
      ]),
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(10s)')
  })
})
