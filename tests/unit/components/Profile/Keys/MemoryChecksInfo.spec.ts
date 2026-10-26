import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import MemoryChecksInfo
  from '../../../../../app/components/Profile/Keys/MemoryChecksInfo.vue'

enableAutoUnmount(afterEach)

describe('Profile/Keys/MemoryChecksInfo', () => {
  it('renders as an info alert', async () => {
    const wrapper = await mountSuspended(MemoryChecksInfo)
    const alert = wrapper.get('[data-testid="memory-checks-info"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.classes()).toContain('alert-info')
  })

  it('lists every TypeSafe AI check and no longer says memory checks only',
    async () => {
      const wrapper = await mountSuspended(MemoryChecksInfo)
      const text = wrapper.get('[data-testid="memory-checks-info"]').text()
        .replace(/\s+/g, ' ')

      expect(text).not.toContain('never for chat')
      expect(text).toContain('memory checks, Auto web search, a memory '
        + 'pre-filter, prompt-injection screening, search re-ranking, a share '
        + 'check and past-chat retrieval')
      expect(text).toContain('Each check sends TypeSafe AI (US) only the text '
        + 'it needs')
      expect(text).toContain('It adds no chat models.')
      expect(text).toContain('Costs a fraction of a cent per check on your '
        + 'TypeSafe AI account.')
    })

  it('links to the TypeSafe AI key guide', async () => {
    const wrapper = await mountSuspended(MemoryChecksInfo)
    const link = wrapper.get('[data-testid="memory-checks-guide-link"]')

    expect(link.text()).toBe('How to get a TypeSafe AI API key')
    expect(link.attributes('href') ?? link.attributes('to'))
      .toBe('/guides/typesafe-ai-api-key')
  })
})
