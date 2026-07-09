import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import DeepResearchTrace from '../../../../app/components/Chat/DeepResearchTrace.vue'

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function createTracePart(entries: { kind: string, text: string }[]) {
  return {
    type: 'data-research-trace',
    data: { entries },
  } as unknown as UIMessage['parts'][number]
}

describe('Chat/DeepResearchTrace', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders nothing when there is no data-research-trace part', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          { type: 'text', text: 'A plain reply.' },
        ]),
      },
    })

    expect(wrapper.find('[data-testid="research-trace"]').exists()).toBe(
      false,
    )
  })

  it('renders nothing when the trace part has no entries', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([createTracePart([])]),
      },
    })

    expect(wrapper.find('[data-testid="research-trace"]').exists()).toBe(
      false,
    )
  })

  it('renders the "Research steps" header and every entry', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          createTracePart([
            { kind: 'thought', text: 'Considering the best sources.' },
            { kind: 'search', text: 'best espresso machines 2026' },
            { kind: 'read', text: 'https://example.com/espresso' },
          ]),
        ]),
      },
    })

    const trace = wrapper.get('[data-testid="research-trace"]')

    expect(trace.text()).toContain('Research steps')

    const entries = trace.findAll('[data-testid="research-trace-entry"]')

    expect(entries).toHaveLength(3)
    expect(entries[0]?.text()).toContain('Considering the best sources.')
    expect(entries[1]?.text()).toContain('best espresso machines 2026')
    expect(entries[2]?.text()).toContain('https://example.com/espresso')
  })

  it('shows the icon matching each entry kind', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          createTracePart([
            { kind: 'thought', text: 'Thinking.' },
            { kind: 'search', text: 'Searching.' },
            { kind: 'read', text: 'Reading.' },
          ]),
        ]),
      },
    })

    const entries = wrapper.findAll('[data-testid="research-trace-entry"]')

    expect(entries[0]?.get('.iconify').classes()).toContain('i-lucide:brain')
    expect(entries[1]?.get('.iconify').classes()).toContain('i-lucide:search')
    expect(entries[2]?.get('.iconify').classes()).toContain('i-lucide:link')
  })

  it('defaults to collapsed when reasoningExpanded is off', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          createTracePart([{ kind: 'thought', text: 'Thinking.' }]),
        ]),
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it('defaults to expanded when reasoningExpanded is on', async () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          createTracePart([{ kind: 'thought', text: 'Thinking.' }]),
        ]),
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeDefined()
  })

  it('toggles open state when the summary is clicked', async () => {
    const wrapper = await mountSuspended(DeepResearchTrace, {
      props: {
        message: createMessage([
          createTracePart([{ kind: 'thought', text: 'Thinking.' }]),
        ]),
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeUndefined()

    await wrapper.find('[data-testid="research-trace-toggle"]')
      .trigger('click')

    expect(wrapper.find('details').attributes('open')).toBeDefined()

    await wrapper.find('[data-testid="research-trace-toggle"]')
      .trigger('click')

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })
})
