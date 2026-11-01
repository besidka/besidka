import type { UIMessage } from 'ai'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AutoWebSearchChip from '../../../../app/components/Chat/AutoWebSearchChip.vue'

const TEXT_PART = { type: 'text', text: 'Answer.' }

function assistantMessage(
  usage?: Record<string, unknown>,
  extraParts: Record<string, unknown>[] = [],
): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts: [TEXT_PART, ...extraParts],
    metadata: usage ? { usage } : undefined,
  } as UIMessage
}

function usageWith(
  autoWebSearch: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    model: 'gpt-5-mini',
    provider: 'openai',
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    autoWebSearch,
    ...extra,
  }
}

async function mountChip(message: UIMessage) {
  const wrapper = await mountSuspended(AutoWebSearchChip, {
    props: { message },
  })

  return wrapper.get('[data-testid="auto-web-search-chip"]')
}

describe('Chat/AutoWebSearchChip', () => {
  it.each(['searched', 'forced', 'fallback'])(
    'says search was allowed but not used for the %s outcome without a search',
    async (outcome) => {
      const chip = await mountChip(assistantMessage(usageWith(outcome)))

      expect(chip.text()).toBe('Auto: search allowed, not used')
      expect(chip.attributes('data-outcome')).toBe(outcome)
      expect(chip.attributes('data-searched')).toBe('false')
    },
  )

  it.each(['qwen', 'vercel-gateway', 'openrouter', 'cloudflare-gateway'])(
    'says search was allowed without claiming it was unused for %s',
    async (provider) => {
      const chip = await mountChip(
        assistantMessage(usageWith('searched', { provider })),
      )

      expect(chip.text()).toBe('Auto: search allowed')
      expect(chip.attributes('data-searched')).toBe('unknown')
    },
  )

  it('says the web was searched for qwen after a completed Exa call',
    async () => {
      const chip = await mountChip(assistantMessage(
        usageWith('forced', { provider: 'qwen' }),
        [{ type: 'tool-web_search_exa', state: 'output-available' }],
      ))

      expect(chip.text()).toBe('Auto: searched the web')
      expect(chip.attributes('data-searched')).toBe('true')
    })

  it('says search was not used for anthropic without a search signal',
    async () => {
      const chip = await mountChip(assistantMessage(
        usageWith('searched', { provider: 'anthropic' }),
      ))

      expect(chip.text()).toBe('Auto: search allowed, not used')
      expect(chip.attributes('data-searched')).toBe('false')
    })

  it('keeps the skipped label on an unobservable provider', async () => {
    const chip = await mountChip(
      assistantMessage(usageWith('skipped', { provider: 'qwen' })),
    )

    expect(chip.text()).toBe('Auto: no web search needed')
    expect(chip.attributes('data-searched')).toBe('false')
  })

  it('labels the skipped outcome', async () => {
    const chip = await mountChip(assistantMessage(usageWith('skipped')))

    expect(chip.text()).toBe('Auto: no web search needed')
    expect(chip.attributes('data-outcome')).toBe('skipped')
    expect(chip.attributes('data-searched')).toBe('false')
  })

  it.each(['searched', 'forced', 'fallback'])(
    'says the web was searched for the %s outcome after a completed Exa call',
    async (outcome) => {
      const chip = await mountChip(assistantMessage(usageWith(outcome), [
        { type: 'tool-web_search_exa', state: 'output-available' },
      ]))

      expect(chip.text()).toBe('Auto: searched the web')
      expect(chip.attributes('data-outcome')).toBe(outcome)
      expect(chip.attributes('data-searched')).toBe('true')
    },
  )

  it('says the web was searched when the message has a source-url part',
    async () => {
      const chip = await mountChip(assistantMessage(usageWith('searched'), [
        { type: 'source-url', sourceId: 's1', url: 'https://example.com' },
      ]))

      expect(chip.text()).toBe('Auto: searched the web')
      expect(chip.attributes('data-searched')).toBe('true')
    })

  it('says the web was searched when usage counted a search unit',
    async () => {
      const chip = await mountChip(assistantMessage(
        usageWith('searched', { searchUnits: 1 }),
      ))

      expect(chip.text()).toBe('Auto: searched the web')
      expect(chip.attributes('data-searched')).toBe('true')
    })

  it('does not count a failed search call without sources or units',
    async () => {
      const chip = await mountChip(assistantMessage(usageWith('searched'), [
        { type: 'tool-web_search_exa', state: 'output-error' },
      ]))

      expect(chip.text()).toBe('Auto: search allowed, not used')
      expect(chip.attributes('data-searched')).toBe('false')
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
