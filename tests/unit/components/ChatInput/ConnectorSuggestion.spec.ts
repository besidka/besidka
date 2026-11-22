import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConnectorSuggestion from '../../../../app/components/ChatInput/ConnectorSuggestion.vue'

enableAutoUnmount(afterEach)

describe('ChatInput/ConnectorSuggestion', () => {
  it('asks before turning a connector on and offers Not now', async () => {
    const wrapper = await mountSuspended(ConnectorSuggestion, {
      props: { title: 'Notion' },
    })

    expect(wrapper.get('[data-testid="connector-suggestion-text"]').text())
      .toBe('Notion is off in this chat. Turn it on?')

    await wrapper.get('[data-testid="connector-suggestion-turn-on"]')
      .trigger('click')
    await wrapper.get('[data-testid="connector-suggestion-dismiss"]')
      .trigger('click')

    expect(wrapper.emitted('turn-on')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('disables Turn on at the connector limit and says why', async () => {
    const wrapper = await mountSuspended(ConnectorSuggestion, {
      props: { title: 'Notion', isAtLimit: true },
    })

    expect((wrapper.get('[data-testid="connector-suggestion-turn-on"]')
      .element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.get('[data-testid="connector-suggestion-limit"]').text())
      .toContain('at most 5 connectors')
  })
})
