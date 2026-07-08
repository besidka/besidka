import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import DeepResearchMeta from '../../../../app/components/Chat/DeepResearchMeta.vue'

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

describe('Chat/DeepResearchMeta', () => {
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
          {
            type: 'data-research',
            data: {
              provider: 'openai',
              level: 'thorough',
              modelId: 'o3-deep-research',
              durationMs: 125_000,
            },
          } as unknown as UIMessage['parts'][number],
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
          {
            type: 'data-research',
            data: {
              provider: 'openai',
              level: 'quick',
              modelId: 'o4-mini-deep-research',
            },
          } as unknown as UIMessage['parts'][number],
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
          {
            type: 'data-research',
            data: {
              provider: 'google',
              level: 'quick',
              modelId: 'deep-research-preview-04-2026',
            },
          } as unknown as UIMessage['parts'][number],
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
          {
            type: 'data-research',
            data: {
              provider: 'google',
              level: 'quick',
              modelId: 'deep-research-preview-04-2026',
            },
          } as unknown as UIMessage['parts'][number],
        ]),
      },
    })

    const meta = wrapper.get('[data-testid="research-meta"]')

    expect(meta.text()).toContain('Deep Research')
    expect(meta.text()).toContain('Quick')
    expect(meta.text()).not.toMatch(/\d+:\d{2}/)
  })
})
