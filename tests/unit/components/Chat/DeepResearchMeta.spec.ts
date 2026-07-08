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

    expect(meta.text()).toContain('Deep research')
    expect(meta.text()).toContain('Thorough')
    expect(meta.text()).toContain('o3-deep-research')
    expect(meta.text()).toContain('2:05')
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

    expect(meta.text()).toContain('deep-research-preview-04-2026')
    expect(meta.text()).not.toMatch(/\d+:\d{2}/)
  })
})
