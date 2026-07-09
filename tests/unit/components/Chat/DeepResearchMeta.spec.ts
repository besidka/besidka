import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import DeepResearchMeta from '../../../../app/components/Chat/DeepResearchMeta.vue'

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function createMetaPart(data: {
  provider: 'openai' | 'google'
  level: 'quick' | 'thorough'
  modelId: string
  durationMs?: number
}) {
  return {
    type: 'data-research',
    data,
  } as unknown as UIMessage['parts'][number]
}

function createTracePart(entries: { kind: string, text: string }[]) {
  return {
    type: 'data-research-trace',
    data: { entries },
  } as unknown as UIMessage['parts'][number]
}

describe('Chat/DeepResearchMeta', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders nothing when there is no data-research part', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          { type: 'text', text: 'A plain reply.' },
        ]),
      },
    })

    expect(wrapper.find('[data-testid="research-meta"]').exists()).toBe(
      false,
    )
  })

  it('renders the level, model, and duration from the metadata part', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'thorough',
            modelId: 'o3-deep-research',
            durationMs: 125_000,
          }),
        ]),
      },
    })

    const meta = wrapper.get('[data-testid="research-meta"]')

    expect(meta.text()).toContain('Thorough')
    expect(meta.text()).toContain('o3 Deep Research')
    expect(meta.text()).toContain('2:05')
  })

  it('renders the OpenAI provider logo and no literal prefix for openai', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
        ]),
      },
    })

    const meta = wrapper.get('[data-testid="research-meta"]')

    // SvgoOpenai and SvgoGeminiShort inline as raw <svg> with no distinct
    // component boundary Vue Test Utils can find by name — the OpenAI mark
    // has a unique viewBox ("0 0 256 260" vs Gemini's "0 0 50 50"), so
    // asserting on that is the reliable way to tell them apart.
    expect(meta.findAll('svg')).toHaveLength(1)
    expect(meta.get('svg').attributes('viewBox')).toBe('0 0 256 260')
    expect(meta.text()).not.toMatch(/^Deep research ·/)
  })

  it('renders the Gemini provider logo for google', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'google',
            level: 'quick',
            modelId: 'deep-research-preview-04-2026',
          }),
        ]),
      },
    })

    const meta = wrapper.get('[data-testid="research-meta"]')

    expect(meta.findAll('svg')).toHaveLength(1)
    expect(meta.get('svg').attributes('viewBox')).toBe('0 0 50 50')
  })

  it('omits the duration segment when durationMs is absent', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'google',
            level: 'quick',
            modelId: 'deep-research-preview-04-2026',
          }),
        ]),
      },
    })

    const meta = wrapper.get('[data-testid="research-meta"]')

    expect(meta.text()).toContain('Deep Research')
    expect(meta.text()).toContain('Quick')
    expect(meta.text()).not.toMatch(/\d+:\d{2}/)
  })

  it('renders a plain, non-clickable line when the message has no trace entries', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
        ]),
      },
    })

    expect(wrapper.find('details').exists()).toBe(false)
    expect(
      wrapper.find('[data-testid="research-trace-toggle"]').exists(),
    ).toBe(false)
    expect(wrapper.findAll('.iconify')).toHaveLength(0)
  })

  it('renders the meta line as the collapse summary when trace entries are present', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'thorough',
            modelId: 'o3-deep-research',
            durationMs: 125_000,
          }),
          createTracePart([
            { kind: 'thought', text: 'Considering the best sources.' },
          ]),
        ]),
      },
    })

    const toggle = wrapper.get('[data-testid="research-trace-toggle"]')

    expect(toggle.text()).toContain('Thorough')
    expect(toggle.text()).toContain('o3 Deep Research')
    expect(toggle.text()).toContain('2:05')
    expect(toggle.get('.iconify').classes()).toContain('i-lucide:chevron-right')
  })

  it('lists every trace entry with the icon matching its kind', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            { kind: 'thought', text: 'Thinking.' },
            { kind: 'search', text: 'Searching.' },
            { kind: 'read', text: 'Reading.' },
          ]),
        ]),
      },
    })

    const entries = wrapper.findAll('[data-testid="research-trace-entry"]')

    expect(entries).toHaveLength(3)
    expect(entries[0]?.get('.iconify').classes()).toContain('i-lucide:brain')
    expect(entries[1]?.get('.iconify').classes()).toContain('i-lucide:search')
    expect(entries[2]?.get('.iconify').classes()).toContain('i-lucide:link')
  })

  it('makes a long thought entry expandable and other entries plain', async () => {
    const longThought = 'This is a long research thought that describes '
      + 'the reasoning process in enough detail to exceed eighty characters.'
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            { kind: 'thought', text: longThought },
            { kind: 'thought', text: 'Short thought.' },
            { kind: 'search', text: 'best espresso machines 2026' },
            { kind: 'read', text: 'https://example.com/espresso' },
          ]),
        ]),
      },
    })

    const entries = wrapper.findAll('[data-testid="research-trace-entry"]')

    expect(
      entries[0]?.find('[data-testid="research-trace-entry-toggle"]')
        .exists(),
    ).toBe(true)
    expect(entries[0]?.text()).toContain(longThought)

    for (const entry of entries.slice(1)) {
      expect(
        entry.find('[data-testid="research-trace-entry-toggle"]').exists(),
      ).toBe(false)
    }

    expect(entries[1]?.text()).toContain('Short thought.')
    expect(entries[2]?.text()).toContain('best espresso machines 2026')
    expect(entries[3]?.text()).toContain('https://example.com/espresso')
  })

  it('toggles a long thought entry open and closed on click', async () => {
    const longThought = 'x'.repeat(90)
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([{ kind: 'thought', text: longThought }]),
        ]),
      },
    })

    const entryDetails = wrapper.get(
      '[data-testid="research-trace-entry"] details',
    )

    expect(entryDetails.attributes('open')).toBeUndefined()

    await wrapper.get('[data-testid="research-trace-entry-toggle"]')
      .trigger('click')

    expect(entryDetails.attributes('open')).toBeDefined()

    await wrapper.get('[data-testid="research-trace-entry-toggle"]')
      .trigger('click')

    expect(entryDetails.attributes('open')).toBeUndefined()
  })

  it('defaults the trace collapse to closed when reasoningExpanded is off', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([{ kind: 'thought', text: 'Thinking.' }]),
        ]),
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it('defaults the trace collapse to open when reasoningExpanded is on', async () => {
    localStorage.setItem('settings_reasoning_expanded', 'true')

    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([{ kind: 'thought', text: 'Thinking.' }]),
        ]),
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeDefined()
  })

  it('toggles the trace collapse open state when the summary is clicked', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
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
