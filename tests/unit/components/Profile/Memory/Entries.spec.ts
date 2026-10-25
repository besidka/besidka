import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import Entries from '../../../../../app/components/Profile/Memory/Entries.vue'

enableAutoUnmount(afterEach)

describe('Profile/Memory/Entries', () => {
  it('renders the section with the empty state by default', async () => {
    const wrapper = await mountSuspended(Entries)
    const section = wrapper.get('[data-testid="memory-entries-section"]')

    expect(section.text()).toContain('What Besidka remembers')
    expect(section.text()).toContain('Nothing remembered yet.')
  })

  it('renders slot content instead of the empty state', async () => {
    const wrapper = await mountSuspended(Entries, {
      slots: {
        default: '<p data-testid="entries-slot">Entry list</p>',
      },
    })

    expect(wrapper.get('[data-testid="entries-slot"]').text())
      .toBe('Entry list')
    expect(wrapper.text()).not.toContain('Nothing remembered yet.')
  })
})
