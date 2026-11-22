import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import Step from '../../../../app/components/Chat/Reasoning/Step.vue'
import { expandReasoningSteps } from './Reasoning/expand-steps'

const resizeCallbacks = vi.hoisted(() => {
  return [] as Array<() => void>
})

mockNuxtImport('useResizeObserver', () => {
  return (_target: unknown, callback: () => void) => {
    resizeCallbacks.push(callback)

    return { stop: vi.fn(), isSupported: ref(true) }
  }
})
mockNuxtImport('useNuxtData', () => {
  return () => ({ data: ref({ connectors: [] }) })
})
mockNuxtImport('useConnectorLibrary', () => {
  return () => ({})
})
mockNuxtImport('useUserSetting', () => {
  return () => ({
    stepsExpanded: shallowRef<boolean>(false),
    stepsAutoHide: shallowRef<boolean>(true),
  })
})

function toolCall(id: string) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__search',
    toolCallId: id,
    state: 'output-available',
    input: { query: id },
    output: 'result',
  }
}

function messageOf(parts: unknown[]): UIMessage {
  return { id: 'msg-live', role: 'assistant', parts } as UIMessage
}

/**
 * The AI SDK publishes a fresh message with shallow copies of every part on
 * each streamed chunk, keeping nested values such as a call's input.
 */
function publish(parts: Array<Record<string, unknown>>): UIMessage {
  return messageOf(parts.map(part => ({ ...part })))
}

async function mountStreaming(parts: Array<Record<string, unknown>>) {
  const wrapper = await mountSuspended(Reasoning, {
    attachTo: document.body,
    props: {
      message: publish(parts),
      status: 'streaming',
      reasoningLevel: 'medium',
      turnStartedAt: Date.now(),
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: Date.now(),
      isTurnThinkingHeld: true,
    },
    global: { stubs: { MDCCached: true } },
  })

  await expandReasoningSteps(wrapper)

  return wrapper
}

describe('Chat/Reasoning while streaming', () => {
  it('keeps the step objects of unchanged steps on a streamed chunk',
    async () => {
      const parts: Array<Record<string, unknown>> = [
        toolCall('call-1'),
        toolCall('call-2'),
        { type: 'reasoning', text: '**Plan**\n\nFirst', state: 'streaming' },
      ]
      const wrapper = await mountStreaming(parts)
      const before = wrapper.findAllComponents(Step).map((component) => {
        return component.props('step')
      })

      parts[2] = { ...parts[2], text: '**Plan**\n\nFirst and more' }
      await wrapper.setProps({ message: publish(parts) })

      const after = wrapper.findAllComponents(Step).map((component) => {
        return component.props('step')
      })

      expect(after).toHaveLength(3)
      expect(after[0]).toBe(before[0])
      expect(after[1]).toBe(before[1])
      expect(after[2]).not.toBe(before[2])
      expect(after[2]!.body).toBe('First and more')

      wrapper.unmount()
    })

  it('renders no steps while the box is collapsed', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: messageOf([toolCall('call-1'), toolCall('call-2')]),
        status: 'ready',
        reasoningLevel: 'medium',
        turnStartedAt: 0,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
      global: { stubs: { MDCCached: true } },
    })

    expect(wrapper.findAllComponents(Step)).toHaveLength(0)

    await expandReasoningSteps(wrapper)

    expect(wrapper.findAllComponents(Step)).toHaveLength(2)
  })

  it('keeps the steps pinned to the bottom until the user scrolls up',
    async () => {
      resizeCallbacks.length = 0

      const wrapper = await mountStreaming([
        toolCall('call-1'),
        toolCall('call-2'),
      ])
      const scroller = wrapper.get(
        '[data-testid="reasoning-steps-scroller"]',
      ).element as HTMLDivElement
      let scrollHeight = 600

      Object.defineProperty(scroller, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      })
      Object.defineProperty(scroller, 'clientHeight', {
        configurable: true,
        get: () => 360,
      })

      const onResize = resizeCallbacks.at(-1)!

      onResize()

      expect(scroller.scrollTop).toBe(600)

      scroller.scrollTop = 580
      scroller.dispatchEvent(new Event('scroll'))
      onResize()

      expect(scroller.scrollTop).toBe(580)

      scroller.scrollTop = 100
      scroller.dispatchEvent(new Event('scroll'))
      scrollHeight = 800
      onResize()

      expect(scroller.scrollTop).toBe(100)

      scroller.scrollTop = 440
      scroller.dispatchEvent(new Event('scroll'))
      onResize()

      expect(scroller.scrollTop).toBe(800)

      wrapper.unmount()
    })

  it('stops following when the user opens a step', async () => {
    resizeCallbacks.length = 0

    const wrapper = await mountStreaming([
      { type: 'reasoning', text: '**Plan**\n\nFirst idea', state: 'done' },
      toolCall('call-1'),
      { type: 'reasoning', text: '**Next**\n\nMore', state: 'streaming' },
    ])
    const scroller = wrapper.get(
      '[data-testid="reasoning-steps-scroller"]',
    ).element as HTMLDivElement

    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => 600,
    })

    await wrapper.findAllComponents(Step)[0]!.get('summary').trigger('click')
    resizeCallbacks.at(-1)!()

    expect(scroller.scrollTop).toBe(0)

    wrapper.unmount()
  })

  it('stops following once the reply is no longer streaming', async () => {
    resizeCallbacks.length = 0

    const wrapper = await mountStreaming([toolCall('call-1')])
    const scroller = wrapper.get(
      '[data-testid="reasoning-steps-scroller"]',
    ).element as HTMLDivElement

    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => 600,
    })

    await wrapper.setProps({ status: 'ready', isTurnThinkingHeld: false })
    await nextTick()
    resizeCallbacks.at(-1)!()

    expect(scroller.scrollTop).toBe(0)

    wrapper.unmount()
  })
})
