import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { VueWrapper } from '@vue/test-utils'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'

const multiStepReasoning = [
  '**Step 1**',
  '',
  'First body',
  '',
  '**Step 2**',
  '',
  'Second body',
].join('\n')

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

async function mountSettledReasoning(text: string): Promise<VueWrapper> {
  return await mountSuspended(Reasoning, {
    props: {
      message: createMessage([{ type: 'reasoning', text }]),
      status: 'ready',
      reasoningLevel: 'low',
      turnStartedAt: Date.now(),
    },
    global: {
      stubs: {
        MDCCached: true,
      },
    },
  })
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

  it('constrains the reasoning steps to an inner max-height scroll wrapper', async () => {
    const wrapper = await mountSettledReasoning('Thinking about the request.')

    const steps = wrapper.get('[data-testid="reasoning-steps"]')
    const scrollWrapper = steps.element.parentElement

    expect(scrollWrapper?.classList.contains('max-h-[360px]')).toBe(true)
    expect(scrollWrapper?.classList.contains('overflow-y-auto')).toBe(true)
    expect(scrollWrapper?.classList.contains('overscroll-contain')).toBe(true)
  })

  it('lays the steps out without daisyUI timeline classes', async () => {
    const wrapper = await mountSettledReasoning(multiStepReasoning)

    expect(wrapper.html()).not.toMatch(/\btimeline(-[a-z-]+)?\b/)

    const steps = wrapper.get('[data-testid="reasoning-steps"]')

    expect(steps.classes()).toContain('flex')
    expect(steps.classes()).toContain('flex-col')
  })

  it('never lets a step row rely on a full-width box with side margins', async () => {
    const wrapper = await mountSettledReasoning(multiStepReasoning)

    const rows = wrapper.findAll('[data-testid="reasoning-steps"] > li')

    expect(rows).toHaveLength(2)

    for (const row of rows) {
      expect(row.classes()).toContain('min-w-0')

      const collapse = row.get('details')

      expect(collapse.classes()).toContain('flex-1')
      expect(collapse.classes()).toContain('min-w-0')
      expect(collapse.classes()).not.toContain('w-full')
      expect(collapse.classes()).not.toContain('mx-2')
    }
  })

  it('draws the connector only between steps, not past the first or last', async () => {
    const wrapper = await mountSettledReasoning(multiStepReasoning)

    const rows = wrapper.findAll('[data-testid="reasoning-steps"] > li')
    const topSelector = '[data-testid="reasoning-step-connector-top"]'
    const bottomSelector = '[data-testid="reasoning-step-connector-bottom"]'

    expect(rows[0]?.find(topSelector).exists()).toBe(false)
    expect(rows[0]?.find(bottomSelector).exists()).toBe(true)
    expect(rows[1]?.find(topSelector).exists()).toBe(true)
    expect(rows[1]?.find(bottomSelector).exists()).toBe(false)
  })

  it('renders a single step with no connector at all', async () => {
    const wrapper = await mountSettledReasoning('Thinking about the request.')

    expect(
      wrapper.find('[data-testid="reasoning-step-connector-top"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="reasoning-step-connector-bottom"]').exists(),
    ).toBe(false)
  })

  it('truncates a long step title but keeps the full text in the tooltip', async () => {
    const longTitle
      = 'Analyzing the request in considerable depth before answering'
    const wrapper = await mountSettledReasoning(`${longTitle}.\n\nSome body text.`)

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Analyzing the request in…')
    expect(title.attributes('title')).toBe(longTitle)
    expect(title.classes()).toContain('truncate')
    expect(title.classes()).toContain('min-w-0')
  })

  it('leaves a short step title untouched', async () => {
    const wrapper = await mountSettledReasoning('Thinking about the request.')

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Thinking about the request')
    expect(title.attributes('title')).toBe('Thinking about the request')
  })

  it('applies the min-h-0 padding treatment to the main summary', async () => {
    const wrapper = await mountSettledReasoning('Thinking about the request.')

    expect(wrapper.get('summary').classes()).toContain('min-h-0')
  })
})
