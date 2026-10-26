import type { UIMessage } from 'ai'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AutoWebSearchChip from '../../../../app/components/Chat/AutoWebSearchChip.vue'

function assistantMessage(usage?: Record<string, unknown>): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Answer.' }],
    metadata: usage ? { usage } : undefined,
  } as UIMessage
}

function usageWith(autoWebSearch: unknown) {
  return {
    model: 'gpt-5-mini',
    provider: 'openai',
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    autoWebSearch,
  }
}

describe('Chat/AutoWebSearchChip', () => {
  it.each([
    ['searched', 'Auto: searched the web'],
    ['forced', 'Auto: searched the web'],
    ['fallback', 'Auto: searched the web'],
    ['skipped', 'Auto: no web search needed'],
  ])('labels the %s outcome', async (outcome, label) => {
    const wrapper = await mountSuspended(AutoWebSearchChip, {
      props: { message: assistantMessage(usageWith(outcome)) },
    })
    const chip = wrapper.get('[data-testid="auto-web-search-chip"]')

    expect(chip.text()).toBe(label)
    expect(chip.attributes('data-outcome')).toBe(outcome)
  })

  it('renders nothing for a message sent without Auto', async () => {
    const wrapper = await mountSuspended(AutoWebSearchChip, {
      props: { message: assistantMessage(usageWith(undefined)) },
    })

    expect(wrapper.find('[data-testid="auto-web-search-chip"]').exists())
      .toBe(false)
  })

  it('renders nothing without usage or for an unknown outcome', async () => {
    const withoutUsage = await mountSuspended(AutoWebSearchChip, {
      props: { message: assistantMessage() },
    })
    const unknown = await mountSuspended(AutoWebSearchChip, {
      props: { message: assistantMessage(usageWith('maybe')) },
    })

    expect(withoutUsage.find('[data-testid="auto-web-search-chip"]').exists())
      .toBe(false)
    expect(unknown.find('[data-testid="auto-web-search-chip"]').exists())
      .toBe(false)
  })
})
