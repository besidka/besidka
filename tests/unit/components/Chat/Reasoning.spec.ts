import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { VueWrapper } from '@vue/test-utils'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function timerLabel(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="reasoning-timer-label"]').text()
}

async function mountAndStartReasoning(
  turnStartedAt: number,
): Promise<VueWrapper> {
  const wrapper = await mountSuspended(Reasoning, {
    props: {
      message: createMessage([]),
      status: 'streaming',
      reasoningLevel: 'low',
      turnStartedAt,
    },
  })

  await wrapper.setProps({
    message: createMessage([
      { type: 'reasoning', text: 'Thinking about the request.' },
    ]),
  })
  await wrapper.vm.$nextTick()

  return wrapper
}

describe('Chat/Reasoning', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows 1s immediately once reasoning starts streaming', async () => {
    const wrapper = await mountAndStartReasoning(Date.now())

    expect(timerLabel(wrapper)).toBe('(1s)')
  })

  it('shows real elapsed time after a JS suspension, not tick count', async () => {
    const wrapper = await mountAndStartReasoning(Date.now())

    vi.setSystemTime(Date.now() + 45000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(46s)')
  })

  it('reports the real duration when reasoning finishes', async () => {
    const wrapper = await mountAndStartReasoning(Date.now())

    vi.setSystemTime(Date.now() + 9000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Thinking about the request.' },
        { type: 'text', text: 'Here is the answer.' },
      ]),
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(10s)')
  })

  it('shows the real elapsed time immediately on a fresh mount, not 1s, when the turn already started earlier', async () => {
    const turnStartedAt = Date.now() - 12_000

    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'reasoning', text: 'Thinking about the request.' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt,
      },
    })

    expect(timerLabel(wrapper)).toBe('(12s)')
  })

  it('keeps counting from the same anchor across a status flicker instead of resetting to 1s', async () => {
    const turnStartedAt = Date.now()
    const wrapper = await mountAndStartReasoning(turnStartedAt)

    vi.setSystemTime(Date.now() + 4000)
    vi.advanceTimersByTime(1000)

    await wrapper.setProps({ status: 'submitted' })
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ status: 'ready' })
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ status: 'streaming' })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).not.toBe('(1s)')
    expect(timerLabel(wrapper)).toBe('(5s)')

    vi.setSystemTime(Date.now() + 4000)
    vi.advanceTimersByTime(1000)

    await wrapper.setProps({ status: 'submitted' })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ status: 'streaming' })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(10s)')
  })

  it('drops the outer collapse chrome when embedded, keeping the step list', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'reasoning', text: 'Thinking about the request.' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        embedded: true,
      },
    })

    expect(wrapper.find('details.group.collapse').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reasoning-timer-label"]').exists())
      .toBe(false)
    expect(wrapper.findAll('ul.timeline > li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Thinking about the request')
  })

  it('keeps the outer collapse chrome by default (non-embedded)', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'reasoning', text: 'Thinking about the request.' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
      },
    })

    expect(wrapper.find('details.group.collapse').exists()).toBe(true)
    expect(wrapper.findAll('ul.timeline > li')).toHaveLength(1)
  })
})
