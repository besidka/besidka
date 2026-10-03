import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import type { VueWrapper } from '@vue/test-utils'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import { isThinkingActive } from '../../../../app/utils/reasoning'

const mocks = vi.hoisted(() => ({
  useUserSetting: vi.fn(),
}))

mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

function setReasoningUserSetting(
  reasoningExpanded: boolean,
  reasoningAutoHide: boolean,
) {
  mocks.useUserSetting.mockReturnValue({
    reasoningExpanded: shallowRef<boolean>(reasoningExpanded),
    reasoningAutoHide: shallowRef<boolean>(reasoningAutoHide),
  })
}

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

function heldFor(parts: UIMessage['parts']): boolean {
  return isThinkingActive(parts)
}

function timerLabel(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="reasoning-timer-label"]').text()
}

function headerSpan(wrapper: VueWrapper) {
  return wrapper.get('summary').get('span.flex')
}

function isMainExpanded(wrapper: VueWrapper): boolean {
  return wrapper.get('details').element.hasAttribute('open')
}

async function mountSettledReasoning(text: string): Promise<VueWrapper> {
  const parts: UIMessage['parts'] = [
    { type: 'reasoning', text, state: 'done' },
  ]

  return await mountSuspended(Reasoning, {
    props: {
      message: createMessage(parts),
      status: 'ready',
      reasoningLevel: 'low',
      turnStartedAt: Date.now(),
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: heldFor(parts),
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
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: turnStartedAt,
      isTurnThinkingHeld: heldFor([]),
    },
  })

  const streamingParts: UIMessage['parts'] = [
    {
      type: 'reasoning',
      text: 'Thinking about the request.',
      state: 'streaming',
    },
  ]

  await wrapper.setProps({
    message: createMessage(streamingParts),
    isTurnThinkingHeld: heldFor(streamingParts),
  })
  await wrapper.vm.$nextTick()

  return wrapper
}

describe('Chat/Reasoning', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setReasoningUserSetting(true, true)
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
        {
          type: 'reasoning',
          text: 'Thinking about the request.',
          state: 'done',
        },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ]),
      reasoningAccumulatedMs: 10000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(10s)')
  })

  it('reports the same duration when text starts one tick before reasoning ends, matching DeepSeek wire order', async () => {
    const wrapper = await mountAndStartReasoning(Date.now())

    vi.setSystemTime(Date.now() + 9000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: 'Thinking about the request.',
          state: 'streaming',
        },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ]),
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: 'Thinking about the request.',
          state: 'done',
        },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ]),
      reasoningAccumulatedMs: 10000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(10s)')
  })

  it('treats an orphaned streaming reasoning part as settled once status leaves streaming', async () => {
    const segmentStartedAt = Date.now()
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Stuck mid-thought.',
            state: 'streaming',
          },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: segmentStartedAt,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: segmentStartedAt,
        isTurnThinkingHeld: true,
      },
    })

    vi.setSystemTime(Date.now() + 1000)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ status: 'ready' })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('summary').text()).not.toContain('Reasoning:')

    const labelAfterOrphan = timerLabel(wrapper)

    vi.setSystemTime(Date.now() + 5000)
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe(labelAfterOrphan)
  })

  it('stays inert on the shared/read-only page configuration', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'reasoning', text: 'Cut mid-thought.', state: 'streaming' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: 0,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: true,
      },
    })

    expect(
      wrapper.find('[data-testid="reasoning-timer-label"]').exists(),
    ).toBe(false)
  })

  it('shows the real elapsed time immediately on a fresh mount, not 1s, when the turn already started earlier', async () => {
    const turnStartedAt = Date.now() - 12_000

    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Thinking about the request.',
            state: 'streaming',
          },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: turnStartedAt,
        isTurnThinkingHeld: true,
      },
    })

    expect(timerLabel(wrapper)).toBe('(12s)')
  })

  it('seeds the frozen duration on a recovery-poll remount that lands after reasoning and any tool calls have already finished, with answer text now streaming', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Thinking about the request.',
            state: 'done',
          },
          { type: 'tool-web_search', state: 'output-available' },
          { type: 'text', text: 'Here is the answer.', state: 'streaming' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now() - 20_000,
        reasoningAccumulatedMs: 4000,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    expect(timerLabel(wrapper)).toBe('(4s)')
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

  it('freezes the true short duration on a Grok-shaped turn instead of counting through the whole tool-calling gap', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
      global: {
        stubs: {
          MDCCached: true,
        },
      },
    })

    const segmentStartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: '**Thinking**\n\nWorking through the details.',
          state: 'streaming',
        },
      ]),
      reasoningSegmentStartedAt: segmentStartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(1s)')

    vi.advanceTimersByTime(250)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('summary').text()).toContain('Reasoning:')
    expect(wrapper.get('summary').text()).toContain('Thinking')
    expect(headerSpan(wrapper).classes()).toContain('gap-1')

    vi.advanceTimersByTime(1750)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: '**Thinking**\n\nWorking through the details.',
          state: 'done',
        },
      ]),
      reasoningAccumulatedMs: 2000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')
    expect(wrapper.get('summary').text()).toContain('Reasoning process')
    expect(
      wrapper.findAll('.reasoning-step-complete'),
    ).toHaveLength(1)

    vi.advanceTimersByTime(15000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: '**Thinking**\n\nWorking through the details.',
          state: 'done',
        },
        { type: 'text', text: 'Answer', state: 'streaming' },
      ]),
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')
    expect(isMainExpanded(wrapper)).toBe(false)
  })

  it('resumes accumulating instead of re-expanding once reasoning reopens after text has started', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const segment1StartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'First pass.', state: 'streaming' },
      ]),
      reasoningSegmentStartedAt: segment1StartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    expect(isMainExpanded(wrapper)).toBe(true)

    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'First pass.', state: 'done' },
        { type: 'text', text: 'Answer so far.', state: 'streaming' },
      ]),
      reasoningAccumulatedMs: 2000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')
    expect(isMainExpanded(wrapper)).toBe(false)

    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')

    const segment2StartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'First pass.', state: 'done' },
        { type: 'text', text: 'Answer so far.', state: 'streaming' },
        { type: 'reasoning', text: 'Second pass.', state: 'streaming' },
      ]),
      reasoningSegmentStartedAt: segment2StartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    expect(isMainExpanded(wrapper)).toBe(false)

    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('summary').text()).toContain('Reasoning:')
    expect(wrapper.get('summary').text()).toContain('Second pass')
    expect(timerLabel(wrapper)).toBe('(3s)')

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'First pass.', state: 'done' },
        { type: 'text', text: 'Answer so far.', state: 'streaming' },
        { type: 'reasoning', text: 'Second pass.', state: 'done' },
      ]),
      reasoningAccumulatedMs: 3000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(3s)')
    expect(isMainExpanded(wrapper)).toBe(false)
  })

  it('never auto-collapses or suppresses re-expansion when reasoningAutoHide is off',
    async () => {
      setReasoningUserSetting(true, false)

      const wrapper = await mountSuspended(Reasoning, {
        props: {
          message: createMessage([]),
          status: 'streaming',
          reasoningLevel: 'low',
          turnStartedAt: Date.now(),
          reasoningAccumulatedMs: 0,
          reasoningSegmentStartedAt: 0,
          isTurnThinkingHeld: false,
        },
      })

      await wrapper.setProps({
        message: createMessage([
          { type: 'reasoning', text: 'First pass.', state: 'streaming' },
        ]),
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      })
      await wrapper.vm.$nextTick()

      expect(isMainExpanded(wrapper)).toBe(true)

      await wrapper.setProps({
        message: createMessage([
          { type: 'reasoning', text: 'First pass.', state: 'done' },
          { type: 'text', text: 'Answer so far.', state: 'streaming' },
        ]),
        reasoningAccumulatedMs: 1000,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      })
      await wrapper.vm.$nextTick()

      expect(isMainExpanded(wrapper)).toBe(true)

      await wrapper.setProps({
        message: createMessage([
          { type: 'reasoning', text: 'First pass.', state: 'done' },
          { type: 'text', text: 'Answer so far.', state: 'streaming' },
          { type: 'reasoning', text: 'Second pass.', state: 'streaming' },
        ]),
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      })
      await wrapper.vm.$nextTick()

      expect(isMainExpanded(wrapper)).toBe(true)
    })

  it('assigns the exact accumulated duration across a multi-step agentic turn and auto-collapses exactly once', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const segmentAStartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'streaming' },
      ]),
      reasoningSegmentStartedAt: segmentAStartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(3s)')

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
      ]),
      reasoningAccumulatedMs: 3000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(3s)')

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
        { type: 'tool-web_search', state: 'input-available' },
      ]),
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(8000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(3s)')

    const segmentBStartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'reasoning', text: 'Step B.', state: 'streaming' },
      ]),
      reasoningSegmentStartedAt: segmentBStartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(4000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(7s)')

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'reasoning', text: 'Step B.', state: 'done' },
        { type: 'tool-web_search', state: 'input-available' },
      ]),
      reasoningAccumulatedMs: 7000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(6000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(7s)')

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'reasoning', text: 'Step B.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'text', text: 'Final answer.', state: 'streaming' },
      ]),
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(7s)')
    expect(isMainExpanded(wrapper)).toBe(false)

    const segmentCStartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        { type: 'reasoning', text: 'Step A.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'reasoning', text: 'Step B.', state: 'done' },
        { type: 'tool-web_search', state: 'output-available' },
        { type: 'text', text: 'Final answer.', state: 'streaming' },
        { type: 'reasoning', text: 'Step C.', state: 'streaming' },
      ]),
      reasoningSegmentStartedAt: segmentCStartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    expect(isMainExpanded(wrapper)).toBe(false)
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

  it(
    'renders the full untruncated title, wrapping instead of clipping, '
    + 'for a bodyless step with a long single-sentence title',
    async () => {
      const longSentence
        = 'The user wants to compare the Toyota Corolla and Camry 2026 '
          + 'to the Kia Ceed.'
      const wrapper = await mountSettledReasoning(longSentence)

      const title = wrapper.get('[data-testid="reasoning-step-title"]')
      const expectedTitle = longSentence.slice(0, -1)

      expect(title.text()).toBe(expectedTitle)
      expect(title.attributes('title')).toBe(expectedTitle)
      expect(title.classes()).not.toContain('truncate')
      expect(title.classes()).toContain('break-words')
      expect(title.classes()).toContain('min-w-0')
    },
  )

  it('applies the min-h-0 padding treatment to the main summary', async () => {
    const wrapper = await mountSettledReasoning('Thinking about the request.')

    expect(wrapper.get('summary').classes()).toContain('min-h-0')
  })

  it(
    'separates the streaming "Reasoning:" prefix from the live summary '
    + 'with a flex gap, for any provider’s reasoning text',
    async () => {
      const wrapper = await mountAndStartReasoning(Date.now())

      vi.advanceTimersByTime(250)
      await wrapper.vm.$nextTick()

      const summary = wrapper.get('summary')

      expect(summary.text()).toContain('Reasoning:')
      expect(summary.text()).toContain('Thinking about the')
      expect(headerSpan(wrapper).classes()).toContain('gap-1')
    },
  )

  it('renders a step and mounts the box for a tool part alone', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'tool-web_search_preview',
            toolCallId: 'call-1',
            state: 'input-available',
          },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      },
    })

    expect(wrapper.find('details').exists()).toBe(true)

    const titles = wrapper.findAll('[data-testid="reasoning-step-title"]')

    expect(titles).toHaveLength(1)
    expect(titles[0]?.text()).toBe('Searching the web')
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(0)
  })

  it('interleaves reasoning and tool steps in true chronological order', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'reasoning', text: 'Step A.', state: 'done' },
          { type: 'tool-web_search_preview', state: 'output-available' },
          { type: 'reasoning', text: 'Step B.', state: 'streaming' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      },
    })

    const titles = wrapper.findAll('[data-testid="reasoning-step-title"]')

    expect(titles.map(title => title.text())).toEqual([
      'Step A',
      'Searched the web',
      'Step B',
    ])
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(2)
  })

  it('keeps the header live via a pending tool call after reasoning has finished', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Thinking about the request.',
            state: 'done',
          },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 2000,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const segmentStartedAt = Date.now()

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: 'Thinking about the request.',
          state: 'done',
        },
        { type: 'tool-web_search_preview', state: 'input-available' },
      ]),
      reasoningSegmentStartedAt: segmentStartedAt,
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(2s)')

    const headerTitle = wrapper.get('[data-testid="reasoning-timer-label"]')
      .element.parentElement

    expect(headerTitle?.classList.contains('skeleton')).toBe(true)

    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(5s)')

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: 'Thinking about the request.',
          state: 'done',
        },
        { type: 'tool-web_search_preview', state: 'output-available' },
      ]),
      reasoningAccumulatedMs: 5000,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    })
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(5s)')

    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(5s)')
  })

  it('switches the header title to the pending tool once reasoning has finished', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
      global: {
        stubs: {
          MDCCached: true,
        },
      },
    })

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: '**Thinking**\n\nWorking through the details.',
          state: 'streaming',
        },
      ]),
      reasoningSegmentStartedAt: Date.now(),
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(250)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('summary').text()).toContain('Reasoning:')
    expect(wrapper.get('summary').text()).toContain('Thinking')

    await wrapper.setProps({
      message: createMessage([
        {
          type: 'reasoning',
          text: '**Thinking**\n\nWorking through the details.',
          state: 'done',
        },
        { type: 'tool-web_search_preview', state: 'input-available' },
      ]),
      reasoningAccumulatedMs: 1000,
      reasoningSegmentStartedAt: Date.now(),
      isTurnThinkingHeld: true,
    })
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(250)
    await wrapper.vm.$nextTick()

    const summary = wrapper.get('summary').text()

    expect(summary).toContain('Searching the web')
    expect(summary).not.toContain('Thinking')
  })

  it('shows the done title and no spinner once a tool call settles to output-available', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'output-available' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Searched the web')
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(1)
  })

  it('renders a failed title for output-error, never spinning indefinitely', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'output-error' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Search failed')
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(0)
    expect(wrapper.findAll('.reasoning-step-failed')).toHaveLength(1)
  })

  it('renders a failed title for output-denied, never spinning indefinitely', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'output-denied' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Search failed')
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(0)
    expect(wrapper.findAll('.reasoning-step-failed')).toHaveLength(1)
  })

  it('renders the plain done title and green dot for approval-requested, not spinning nor failed', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'approval-requested' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const title = wrapper.get('[data-testid="reasoning-step-title"]')

    expect(title.text()).toBe('Searched the web')
    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(1)
    expect(wrapper.findAll('.reasoning-step-failed')).toHaveLength(0)
  })

  it('treats an orphaned pending tool call as settled once status leaves streaming', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'input-available' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      },
    })

    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(0)

    await wrapper.setProps({ status: 'ready' })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.reasoning-step-complete')).toHaveLength(1)
  })

  it('never turns a generate_image tool part into a reasoning step', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Thinking about the request.',
            state: 'done',
          },
          { type: 'tool-generate_image', state: 'input-available' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const titles = wrapper.findAll('[data-testid="reasoning-step-title"]')

    expect(titles).toHaveLength(1)
    expect(titles[0]?.text()).toBe('Thinking about the request')
    expect(
      wrapper.find('[data-testid="reasoning-timer-label"]').exists(),
    ).toBe(false)
  })

  it('titles a Moonshot-shaped dynamic tool key and a generic tool name', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-$web_search', state: 'input-available' },
          { type: 'tool-some_other_thing', state: 'input-available' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      },
    })

    const titles = wrapper.findAll('[data-testid="reasoning-step-title"]')

    expect(titles.map(title => title.text())).toEqual([
      'Searching the web',
      'Using some other thing',
    ])
  })

  it('still auto-expands the single expandable step once settled, with a tool step present', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: '**Step 1**\n\nSome body text.',
            state: 'done',
          },
          { type: 'tool-web_search_preview', state: 'output-available' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
      global: {
        stubs: {
          MDCCached: true,
        },
      },
    })

    await wrapper.get('summary').trigger('click')
    await wrapper.vm.$nextTick()

    expect(isMainExpanded(wrapper)).toBe(true)

    const reasoningStepDetails = wrapper.findAll('details')[1]

    expect(reasoningStepDetails?.attributes('open')).toBeDefined()
  })

  it('exposes no chevron for a bodyless tool step and ignores clicks on it', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'output-available' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    const stepDetails = wrapper.findAll('details')[1]
    const stepSummary = stepDetails!.get('summary')

    expect(stepSummary.find('.iconify').exists()).toBe(false)

    await stepSummary.trigger('click')
    await wrapper.vm.$nextTick()

    expect(
      wrapper.findAll('details')[1]?.attributes('open'),
    ).toBeUndefined()
  })

  it(
    'keeps the live tool title bare, without a leaked "Reasoning:" '
    + 'prefix, for a tool-only turn with zero reasoning-kind steps',
    async () => {
      const wrapper = await mountSuspended(Reasoning, {
        props: {
          message: createMessage([]),
          status: 'streaming',
          reasoningLevel: 'low',
          turnStartedAt: Date.now(),
          reasoningAccumulatedMs: 0,
          reasoningSegmentStartedAt: 0,
          isTurnThinkingHeld: false,
        },
      })

      await wrapper.setProps({
        message: createMessage([
          {
            type: 'tool-web_search_preview',
            state: 'input-available',
          },
        ]),
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      })
      await wrapper.vm.$nextTick()

      vi.advanceTimersByTime(250)
      await wrapper.vm.$nextTick()

      const summary = wrapper.get('summary').text()

      expect(summary).toContain('Searching the web')
      expect(summary).not.toContain('Reasoning:')
    },
  )

  it('uses non-"Reasoning" wording for a tool-only box with zero reasoning-kind steps', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          { type: 'tool-web_search_preview', state: 'output-available' },
        ]),
        status: 'ready',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
    })

    expect(wrapper.get('summary').text()).not.toContain('Reasoning')
  })

  it('trusts the held prop over its own derivation from parts, keeping the live wording and timer running for fully settled parts while a turn is held active', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: createMessage([
          {
            type: 'reasoning',
            text: 'Thinking about the request.',
            state: 'done',
          },
          { type: 'tool-web_search_preview', state: 'output-available' },
        ]),
        status: 'streaming',
        reasoningLevel: 'low',
        turnStartedAt: Date.now(),
        reasoningAccumulatedMs: 2000,
        reasoningSegmentStartedAt: Date.now(),
        isTurnThinkingHeld: true,
      },
    })

    expect(wrapper.get('summary').text()).toContain('Reasoning')
    expect(wrapper.get('summary').text()).not.toContain('Reasoning process')

    const headerTitle = wrapper.get('[data-testid="reasoning-timer-label"]')
      .element.parentElement

    expect(headerTitle?.classList.contains('skeleton')).toBe(true)

    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()

    expect(timerLabel(wrapper)).toBe('(5s)')
  })
})
