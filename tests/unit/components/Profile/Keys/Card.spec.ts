import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Card from '../../../../../app/components/Profile/Keys/Card.vue'

function mountCard(props: Record<string, unknown> = {}) {
  return mountSuspended(Card, {
    props: {
      providerId: 'anthropic',
      label: 'Anthropic',
      status: 'missing',
      ...props,
    },
    slots: {
      default: () => 'Key form body',
    },
  })
}

describe('Profile/Keys/Card', () => {
  it('renders collapsed by default so the page opens as a compact list',
    async () => {
      const wrapper = await mountCard()

      expect(wrapper.find('details').attributes('open')).toBeUndefined()
    })

  it('renders expanded on the first render when asked to open, so the '
    + 'server markup carries no layout shift', async () => {
    const wrapper = await mountCard({ open: true })

    expect(wrapper.find('details').attributes('open')).toBeDefined()
  })

  it('expands later when the open prop flips after mount', async () => {
    const wrapper = await mountCard()

    await wrapper.setProps({ open: true })

    expect(wrapper.find('details').attributes('open')).toBeDefined()
  })

  it('reports an expanded card on mount', async () => {
    const wrapper = await mountCard({ open: true })

    expect(wrapper.emitted('expandedChange')).toEqual([[true, 'auto']])
  })

  it('reports nothing on mount for a collapsed card', async () => {
    const wrapper = await mountCard()

    expect(wrapper.emitted('expandedChange')).toBeUndefined()
  })

  it('reports the open prop flipping after mount', async () => {
    const wrapper = await mountCard()

    await wrapper.setProps({ open: true })
    await nextTick()

    expect(wrapper.emitted('expandedChange')).toEqual([[true, 'auto']])
  })

  it('reports a toggle after a summary click as a user action', async () => {
    const wrapper = await mountCard()
    const details = wrapper.get('details').element as HTMLDetailsElement

    await wrapper.get('summary').trigger('click')
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await wrapper.get('summary').trigger('click')
    details.open = false
    details.dispatchEvent(new Event('toggle'))

    expect(wrapper.emitted('expandedChange')).toEqual([
      [true, 'user'],
      [false, 'user'],
    ])
  })

  it('reports a toggle without a summary click as automatic', async () => {
    const wrapper = await mountCard()
    const details = wrapper.get('details').element as HTMLDetailsElement

    details.open = true
    details.dispatchEvent(new Event('toggle'))

    expect(wrapper.emitted('expandedChange')).toEqual([[true, 'auto']])
  })

  it('always renders the provider name and body in the markup', async () => {
    const wrapper = await mountCard()

    expect(wrapper.find('summary').text()).toContain('Anthropic')
    expect(wrapper.text()).toContain('Key form body')
  })

  it('shows a saved badge and no missing badge when a key is stored',
    async () => {
      const wrapper = await mountCard({ status: 'saved' })

      expect(wrapper.find('[data-testid="key-status-saved"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="key-status-missing"]').exists())
        .toBe(false)
      expect(wrapper.find('summary').text()).toContain('Key saved')
    })

  it('shows a missing badge when no key is stored', async () => {
    const wrapper = await mountCard({ status: 'missing' })

    expect(wrapper.find('[data-testid="key-status-missing"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="key-status-saved"]').exists())
      .toBe(false)
  })

  it('shows neither badge while the key status is unknown', async () => {
    const wrapper = await mountCard({ status: 'unknown' })

    expect(wrapper.find('[data-testid="key-status-saved"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="key-status-missing"]').exists())
      .toBe(false)
  })

  it('joins a native exclusive accordion group when given a group name',
    async () => {
      const wrapper = await mountCard({ group: 'profile-provider-keys' })

      expect(wrapper.find('details').attributes('name'))
        .toBe('profile-provider-keys')
    })

  it('stays independent when no group name is given', async () => {
    const wrapper = await mountCard()

    expect(wrapper.find('details').attributes('name')).toBeUndefined()
  })
})
