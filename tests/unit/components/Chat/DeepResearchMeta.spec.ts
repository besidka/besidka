import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import DeepResearchMeta from '../../../../app/components/Chat/DeepResearchMeta.vue'

const useConfirmMock = vi.hoisted(() => {
  return vi.fn<() => Promise<{ label: string, index: number } | null>>(
    async () => null,
  )
})

mockNuxtImport('useConfirm', () => {
  return useConfirmMock
})

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
    useConfirmMock.mockReset().mockResolvedValue(null)
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

  it('makes an entry with a separable description expandable, others plain', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            {
              kind: 'thought',
              text: '**Assessing options** Comparing the top candidates'
                + ' in detail.',
            },
            { kind: 'thought', text: 'Short thought.' },
            { kind: 'search', text: 'best espresso machines 2026' },
            { kind: 'read', text: 'https://example.com/espresso' },
          ]),
        ]),
      },
    })

    const entries = wrapper.findAll('[data-testid="research-trace-entry"]')
    const firstToggle = entries[0]?.get(
      '[data-testid="research-trace-entry-toggle"]',
    )

    expect(firstToggle?.text()).toContain('Assessing options')
    expect(firstToggle?.text()).not.toContain('Comparing the top candidates')
    expect(entries[0]?.text()).toContain('Comparing the top candidates')

    for (const entry of [entries[1], entries[2]]) {
      expect(
        entry?.find('[data-testid="research-trace-entry-toggle"]').exists(),
      ).toBe(false)
    }

    expect(entries[1]?.text()).toContain('Short thought.')
    expect(entries[2]?.text()).toContain('best espresso machines 2026')

    const linkEntry = entries[3]

    expect(
      linkEntry?.find('[data-testid="research-trace-entry-toggle"]').exists(),
    ).toBe(false)
    expect(
      linkEntry?.find('[data-testid="research-trace-link"]').exists(),
    ).toBe(true)
    expect(linkEntry?.text()).toContain('example.com')
  })

  it('toggles an entry with a separable description open and closed', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            {
              kind: 'thought',
              text: '**Investigating options** '.concat('x'.repeat(90)),
            },
          ]),
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

  it('renders a read entry as a clickable link badge with the hostname label', async () => {
    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            { kind: 'read', text: 'https://www.example.com/research/crdt' },
          ]),
        ]),
      },
    })

    const link = wrapper.get('[data-testid="research-trace-link"]')

    expect(link.text()).toBe('example.com')
    expect(link.element.tagName).toBe('BUTTON')
  })

  it('opens a read link directly through the confirm dialog when accepted', async () => {
    useConfirmMock.mockResolvedValue({ label: 'Open', index: 0 })

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            { kind: 'read', text: 'https://example.com/research/crdt' },
          ]),
        ]),
      },
    })

    await wrapper.get('[data-testid="research-trace-link"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(useConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Open example.com?',
    }))
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/research/crdt',
      '_blank',
      'noopener,noreferrer',
    )

    windowOpen.mockRestore()
  })

  it('does not open a read link when the confirm dialog is declined', async () => {
    useConfirmMock.mockResolvedValue(null)

    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = await mountSuspended(DeepResearchMeta, {
      props: {
        message: createMessage([
          createMetaPart({
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          }),
          createTracePart([
            { kind: 'read', text: 'https://example.com/research/crdt' },
          ]),
        ]),
      },
    })

    await wrapper.get('[data-testid="research-trace-link"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(windowOpen).not.toHaveBeenCalled()

    windowOpen.mockRestore()
  })
})
