import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DirectoryCard from '../../../../../app/components/Profile/Connectors/DirectoryCard.vue'
import type { ConnectorDirectoryItem } from '#shared/types/connectors.d'
import { createDirectoryItem } from '../../../../setup/helpers/connectors-ui'

enableAutoUnmount(afterEach)

function mountCard(item: ConnectorDirectoryItem) {
  return mountSuspended(DirectoryCard, { props: { item } })
}

describe('Profile/Connectors/DirectoryCard', () => {
  it('shows the entry as plain text with its registry icon and a primary Add', async () => {
    const item = createDirectoryItem({
      description: '<script>alert(1)</script> Tracks issues',
    })
    const wrapper = await mountCard(item)

    expect(wrapper.text()).toContain('Tracker')
    expect(wrapper.text()).toContain('by example.io')
    expect(wrapper.text()).toContain('mcp.tracker.example.com')
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get('[data-testid="connector-avatar-image"]')
      .attributes('src'))
      .toBe('/api/v1/connectors/registry/icon?id=io.example%2Ftracker%401.0.0')
    expect(wrapper.find('[data-testid="connector-directory-community"]')
      .text()).toBe('Community')
    expect(wrapper.find('[data-testid="connector-directory-featured"]')
      .exists()).toBe(false)

    const add = wrapper.get('[data-testid="connector-directory-add"]')

    expect(add.classes()).toContain('btn-primary')

    await add.trigger('click')
    await wrapper.get('[data-testid="connector-directory-open"]')
      .trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual([item])
    expect(wrapper.emitted('open')?.[0]).toEqual([item])
  })

  it('marks an added entry and keeps it openable', async () => {
    const wrapper = await mountCard(createDirectoryItem({
      isAdded: true,
      addedConnectorId: 'conn1',
      isCurated: true,
    }))

    expect(wrapper.get('[data-testid="connector-directory-added"]').text())
      .toBe('Added')
    expect(wrapper.find('[data-testid="connector-directory-add"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="connector-directory-featured"]')
      .attributes('aria-label')).toContain('Not a security review')
    expect(wrapper.find('[data-testid="connector-directory-community"]')
      .exists()).toBe(false)
    expect(wrapper.find('[data-testid="connector-directory-open"]').exists())
      .toBe(true)
  })

  it('uses the bundled mark for a preset card instead of a registry icon', async () => {
    const wrapper = await mountCard(createDirectoryItem({
      id: 'preset:github',
      name: 'preset/github',
      title: 'GitHub',
      presetId: 'github',
      publisher: null,
    }))

    expect(wrapper.find('[data-testid="connector-avatar-image"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)
  })

  it('shows no Add button for a server whose sign-in refuses Besidka', async () => {
    const wrapper = await mountCard(createDirectoryItem({
      id: 'preset:vercel',
      name: 'preset/vercel',
      title: 'Vercel',
      host: 'mcp.vercel.com',
      remoteUrl: 'https://mcp.vercel.com/',
      presetId: 'vercel',
      publisher: null,
      isCurated: true,
    }))

    expect(wrapper.find('[data-testid="connector-directory-add"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="connector-directory-unavailable"]')
      .text()).toBe('Sign-in not available for Besidka yet')
    expect(wrapper.find('[data-testid="connector-directory-open"]').exists())
      .toBe(true)
  })

  it('keeps an added connector on an unavailable host as Added', async () => {
    const wrapper = await mountCard(createDirectoryItem({
      host: 'mcp.figma.com',
      isAdded: true,
      addedConnectorId: 'conn1',
    }))

    expect(wrapper.find('[data-testid="connector-directory-added"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="connector-directory-unavailable"]')
      .exists()).toBe(false)
  })
})
