import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { neverStoreKinds } from '../../../../../shared/utils/memory-policy'
import NeverKept from '../../../../../app/components/Profile/Memory/NeverKept.vue'

enableAutoUnmount(afterEach)

async function mountNeverKept() {
  return await mountSuspended(NeverKept)
}

describe('Profile/Memory/NeverKept', () => {
  it('renders the section heading', async () => {
    const wrapper = await mountNeverKept()

    expect(wrapper.get('h2').text()).toBe('What memory never keeps')
  })

  it('states that sensitive topics are never saved', async () => {
    const wrapper = await mountNeverKept()

    expect(wrapper.get('[data-testid="memory-never-kept-note"]').text())
      .toContain(
        'Sensitive topics (health, religion, politics and similar) '
        + 'are never saved to memory.',
      )
  })

  it('links to the privacy policy page', async () => {
    const wrapper = await mountNeverKept()
    const link = wrapper.get('[data-testid="memory-never-kept-privacy-link"]')

    expect(link.text()).toBe('See the Privacy Policy.')
    expect(link.attributes('href') ?? link.attributes('to'))
      .toBe('/privacy-policy')
  })

  it('renders the never-store list from neverStoreKinds', async () => {
    const wrapper = await mountNeverKept()
    const items = wrapper.findAll('[data-testid="memory-never-store-list"] li')

    expect(items.map(item => item.text()))
      .toEqual(neverStoreKinds.map(kind => kind.label))
  })

  it('offers no toggle or other control', async () => {
    const wrapper = await mountNeverKept()

    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
