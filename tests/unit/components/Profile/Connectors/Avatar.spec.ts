import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import Avatar from '../../../../../app/components/Profile/Connectors/Avatar.vue'

enableAutoUnmount(afterEach)

const cachedConnector = ref<{ host: string } | null>(null)

mockNuxtImport('useConnectorById', () => {
  return () => computed(() => cachedConnector.value)
})

beforeEach(() => {
  cachedConnector.value = null
})

describe('Profile/Connectors/Avatar', () => {
  it('shows a letter when nothing can be fetched', async () => {
    const wrapper = await mountSuspended(Avatar, { props: { title: 'sentry' } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('S')
  })

  it('loads a connector icon only through our route, and only when available',
    async () => {
      const unavailable = await mountSuspended(Avatar, {
        props: { title: 'Notion', connectorId: 'c1' },
      })

      expect(unavailable.find('img').exists()).toBe(false)

      const available = await mountSuspended(Avatar, {
        props: { title: 'Notion', connectorId: 'c1', isIconAvailable: true },
      })
      const image = available.find('img')

      expect(image.attributes('src')).toBe('/api/v1/connectors/c1/icon')
      expect(image.attributes('referrerpolicy')).toBe('no-referrer')
      expect(image.attributes('alt')).toBe('')
    })

  it('loads a directory icon from the registry route by id, url-encoded',
    async () => {
      const wrapper = await mountSuspended(Avatar, {
        props: { title: 'Linear', registryId: 'app.linear/linear@1.0.2' },
      })

      expect(wrapper.find('img').attributes('src'))
        .toBe('/api/v1/connectors/registry/icon?id='
          + 'app.linear%2Flinear%401.0.2')
    })

  it('falls back to the letter when the image fails', async () => {
    const wrapper = await mountSuspended(Avatar, {
      props: { title: 'Linear', registryId: 'x@1' },
    })

    await wrapper.find('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('L')
  })

  it('tries again when the icon address changes', async () => {
    const wrapper = await mountSuspended(Avatar, {
      props: { title: 'Linear', registryId: 'a@1' },
    })

    await wrapper.find('img').trigger('error')
    await wrapper.setProps({ registryId: 'b@1' })

    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('draws a preset brand mark when there is no image to ask for', async () => {
    const wrapper = await mountSuspended(Avatar, {
      props: { title: 'GitHub', presetId: 'github', connectorId: 'c1' },
    })

    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('prefers the connected icon, and falls back to the brand mark when '
    + 'it fails', async () => {
    const wrapper = await mountSuspended(Avatar, {
      props: {
        title: 'Linear',
        presetId: 'linear',
        connectorId: 'c1',
        isIconAvailable: true,
      },
    })

    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)

    await wrapper.find('img').trigger('load')

    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(false)

    await wrapper.find('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)
  })

  it('keeps the letter visible until the image has loaded', async () => {
    const wrapper = await mountSuspended(Avatar, {
      props: { title: 'Notion', registryId: 'com.notion/mcp@1.0.0' },
    })

    expect(wrapper.text()).toBe('N')
    expect(wrapper.find('img').classes()).toContain('opacity-0')

    await wrapper.find('img').trigger('load')

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('img').classes()).not.toContain('opacity-0')
  })

  it('draws the preset brand mark for a connector added by URL whose host '
    + 'belongs to a preset', async () => {
    cachedConnector.value = { host: 'mcp.cloudflare.com' }

    const wrapper = await mountSuspended(Avatar, {
      props: { title: 'Cloudflare', connectorId: 'c9' },
    })

    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)
    expect(wrapper.text()).not.toBe('C')
  })

  it('keeps the letter for a URL-added connector on an unknown host',
    async () => {
      cachedConnector.value = { host: 'mcp.example.com' }

      const wrapper = await mountSuspended(Avatar, {
        props: { title: 'Cloudflare', connectorId: 'c9' },
      })

      expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
        .toBe(false)
      expect(wrapper.text()).toBe('C')
    })
})
