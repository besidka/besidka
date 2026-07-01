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

async function mountAndStartReasoning(): Promise<VueWrapper> {
  const wrapper = await mountSuspended(Reasoning, {
    props: {
      message: createMessage([]),
      status: 'streaming',
      reasoningLevel: 'low',
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
    const wrapper = await mountAndStartReasoning()

    expect(timerLabel(wrapper)).toBe('(1s)')
  })

  it('shows real elapsed time after a JS suspension, not tick count', async () => {
    const wrapper = await mountAndStartReasoning()

    vi.setSystemTime(Date.now() + 45000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(46s)')
  })

  it('reports the real duration when reasoning finishes', async () => {
    const wrapper = await mountAndStartReasoning()

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
})
