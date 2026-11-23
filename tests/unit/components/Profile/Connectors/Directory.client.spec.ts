import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import Directory from '../../../../../app/components/Profile/Connectors/Directory.client.vue'
import type { ConnectorDirectoryHome } from '#shared/types/connectors.d'
import { resolveGoogleEntries } from '../../../../../app/utils/google-entries'
import type { GoogleEntry } from '../../../../../app/utils/google-entries'
import { createDirectoryItem } from '../../../../setup/helpers/connectors-ui'

function createGoogleEntries(isConnected = false): GoogleEntry[] {
  return resolveGoogleEntries({
    status: {
      connection: isConnected
        ? {
          clientMode: 'besidka',
          status: 'active',
          email: 'person@example.test',
          isWorkspaceAccount: false,
          capabilities: ['identity', 'drive-picked'],
          connectedAt: '2026-11-22T12:00:00.000Z',
        }
        : null,
      canConnect: true,
      dedicatedClient: true,
      byo: {
        canManage: true,
        redirectUri: 'https://besidka.example/api/v1/google/byo/callback',
        hasClient: true,
        connection: null,
      },
    },
    driveFeature: { enabled: true, active: true },
    isGmailActive: true,
    isCalendarActive: true,
  })
}

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshHome: vi.fn(),
  add: vi.fn(),
  openEntry: vi.fn(),
  openGooglePanel: vi.fn(),
}))

const homeData = ref<ConnectorDirectoryHome | null>(null)
const isAdmin = ref<boolean>(false)
const googleEntries = ref<GoogleEntry[]>([])

mockNuxtImport('useGoogleEntries', () => {
  return () => ({ entries: googleEntries })
})
mockNuxtImport('useGoogleEntryPanel', () => {
  return () => ({ open: mocks.openGooglePanel })
})

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useIsAdmin', () => () => computed(() => isAdmin.value))
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: homeData,
    error: ref(null),
    refresh: mocks.refreshHome,
  })
})
mockNuxtImport('useConnectorsPage', () => {
  return () => ({ connectors: computed(() => []) })
})
mockNuxtImport('useConnectorDirectoryActions', () => {
  return () => ({
    isAdding: ref(false),
    add: mocks.add,
    openEntry: mocks.openEntry,
    openAdded: vi.fn(),
  })
})

function sectionItems(prefix: string, count: number) {
  return Array.from({ length: count }, (_item, index) => {
    return createDirectoryItem({
      id: `${prefix}-${index}@1.0.0`,
      name: `io.example/${prefix}-${index}`,
      title: `${prefix} ${index}`,
    })
  })
}

function createHome(): ConnectorDirectoryHome {
  return {
    top: sectionItems('top', 6),
    topCount: 35,
    new: sectionItems('new', 6),
    newCount: 12000,
    categories: [{
      id: 'design',
      label: 'Design',
      count: 3,
      items: sectionItems('design', 3),
    }],
    total: 12432,
  }
}

async function mountDirectory() {
  const wrapper = await mountSuspended(Directory)

  await flushPromises()

  return wrapper
}

describe('Profile/Connectors/Directory', () => {
  beforeEach(() => {
    homeData.value = createHome()
    isAdmin.value = false
    googleEntries.value = []
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
    mocks.fetch.mockResolvedValue({
      items: sectionItems('list', 20),
      nextCursor: 20,
      total: 35,
    })
  })

  it('shows Top, New and the categories with counts and Show all', async () => {
    const wrapper = await mountDirectory()
    const top = wrapper.get('[data-testid="connector-directory-section-top"]')
    const design = wrapper
      .get('[data-testid="connector-directory-section-design"]')

    expect(top.text()).toContain('Top connectors')
    expect(top.text()).toContain('35')
    expect(top.findAll('[data-testid="connector-directory-card"]'))
      .toHaveLength(6)
    expect(wrapper.get('[data-testid="connector-directory-section-new"]')
      .text()).toContain('New connectors')
    expect(design.text()).toContain('Design')
    expect(design.find('[data-testid="connector-directory-show-all-design"]')
      .exists()).toBe(false)
    expect(wrapper.text()).toContain('Not reviewed by Besidka')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('opens the full list of a section, pages it and goes back', async () => {
    const wrapper = await mountDirectory()

    await wrapper.get('[data-testid="connector-directory-show-all-top"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/registry', {
      query: { view: 'top' },
    })
    expect(wrapper.get('[data-testid="connector-directory-list"]').text())
      .toContain('Top connectors')
    expect(wrapper.findAll('[data-testid="connector-directory-card"]'))
      .toHaveLength(20)

    await wrapper.get('[data-testid="connector-directory-more"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/connectors/registry',
      { query: { view: 'top', cursor: 20 } },
    )

    await wrapper.get('[data-testid="connector-directory-back"]')
      .trigger('click')

    expect(wrapper.find('[data-testid="connector-directory-section-top"]')
      .exists()).toBe(true)
  })

  it('asks for a category by its id', async () => {
    homeData.value = {
      ...createHome(),
      categories: [{
        id: 'design',
        label: 'Design',
        count: 40,
        items: sectionItems('design', 6),
      }],
    }

    const wrapper = await mountDirectory()

    await wrapper.get('[data-testid="connector-directory-show-all-design"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/registry', {
      query: { category: 'design' },
    })
  })

  it('searches globally after a pause', async () => {
    const wrapper = await mountDirectory()

    await wrapper.get('[data-testid="connector-directory-query"]')
      .setValue('notion')
    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/registry', {
      query: { q: 'notion' },
    })
    expect(wrapper.get('[data-testid="connector-directory-list"]').text())
      .toContain('Results')
    expect(wrapper.find('[data-testid="connector-directory-back"]').exists())
      .toBe(false)
  })

  it('opens an entry and adds one through the shared actions', async () => {
    const wrapper = await mountDirectory()
    const card = wrapper.get('[data-testid="connector-directory-card"]')

    await card.get('[data-testid="connector-directory-open"]')
      .trigger('click')
    await card.get('[data-testid="connector-directory-add"]').trigger('click')

    expect(mocks.openEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'top-0@1.0.0' }),
    )
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'top-0@1.0.0' }),
    )
  })

  it('says the directory is being copied for an empty mirror', async () => {
    homeData.value = { ...createHome(), syncing: true }

    const wrapper = await mountDirectory()

    expect(wrapper.find('[data-testid="connector-directory-syncing"]')
      .exists()).toBe(true)
    expect(wrapper.find('[data-testid="connector-directory-section-top"]')
      .exists()).toBe(false)
  })

  describe('Built into Besidka', () => {
    const SECTION = '[data-testid="connector-directory-section-built-in"]'
    const CARD = '[data-testid="google-entry-card"]'

    it('is the first section with the same entries as Yours', async () => {
      googleEntries.value = createGoogleEntries()

      const wrapper = await mountDirectory()
      const sections = wrapper.findAll('section')
      const section = wrapper.get(SECTION)

      expect(sections[0]!.attributes('data-testid'))
        .toBe('connector-directory-section-built-in')
      expect(section.get('h3').text()).toContain('Built into Besidka')
      expect(section.findAll(CARD).map(card => card.attributes('data-entry-id')))
        .toEqual(['google-drive', 'google-gmail', 'google-calendar'])
    })

    it('is not listed when no Google entry is available', async () => {
      const wrapper = await mountDirectory()

      expect(wrapper.find(SECTION).exists()).toBe(false)
    })

    it('shows Connected or Connect and opens the panel', async () => {
      googleEntries.value = createGoogleEntries(true)

      const wrapper = await mountDirectory()
      const cards = wrapper.findAll(CARD)

      expect(cards[0]!.find('[data-testid="google-entry-card-connected"]')
        .exists()).toBe(true)
      expect(cards[1]!.find('[data-testid="google-entry-card-connect"]')
        .exists()).toBe(true)

      await cards[1]!.get('[data-testid="google-entry-card-connect"]')
        .trigger('click')
      await cards[2]!.get('[data-testid="google-entry-card-open"]')
        .trigger('click')

      expect(mocks.openGooglePanel).toHaveBeenNthCalledWith(1, 'google-gmail')
      expect(mocks.openGooglePanel)
        .toHaveBeenNthCalledWith(2, 'google-calendar')
    })

    it('does not count toward the Added state of the directory', async () => {
      googleEntries.value = createGoogleEntries(true)

      const wrapper = await mountDirectory()

      expect(wrapper.find(SECTION)
        .find('[data-testid="connector-directory-added"]').exists())
        .toBe(false)
      expect(wrapper.find(SECTION)
        .find('[data-testid="connector-directory-card"]').exists())
        .toBe(false)
    })

    it.each([
      ['google', ['google-drive', 'google-gmail', 'google-calendar']],
      ['gmail', ['google-gmail']],
      ['calendar', ['google-calendar']],
      ['sheets', ['google-drive']],
    ])('puts the matching entries above the results for %s',
      async (word, expectedIds) => {
        googleEntries.value = createGoogleEntries()

        const wrapper = await mountDirectory()

        await wrapper.get('[data-testid="connector-directory-query"]')
          .setValue(word)
        await new Promise(resolve => setTimeout(resolve, 350))
        await flushPromises()

        const sections = wrapper.findAll('section')

        expect(sections[0]!.attributes('data-testid'))
          .toBe('connector-directory-section-built-in')
        expect(sections[1]!.attributes('data-testid'))
          .toBe('connector-directory-list')
        expect(wrapper.findAll(CARD).map(card => card.attributes('data-entry-id')))
          .toEqual(expectedIds)
        expect(wrapper.get('[data-testid="connector-directory-total"]').text())
          .toBe('35')
      })

    it('stays out of a search that does not mention Google', async () => {
      googleEntries.value = createGoogleEntries()

      const wrapper = await mountDirectory()

      await wrapper.get('[data-testid="connector-directory-query"]')
        .setValue('notion')
      await new Promise(resolve => setTimeout(resolve, 350))
      await flushPromises()

      expect(wrapper.find(SECTION).exists()).toBe(false)
    })

    it('stays out of the full list of another section', async () => {
      googleEntries.value = createGoogleEntries()

      const wrapper = await mountDirectory()

      await wrapper.get('[data-testid="connector-directory-show-all-top"]')
        .trigger('click')
      await flushPromises()

      expect(wrapper.find(SECTION).exists()).toBe(false)
    })
  })

  it('shows Sync now to admins only', async () => {
    const wrapper = await mountDirectory()

    expect(wrapper.find('[data-testid="connector-registry-sync-now"]')
      .exists()).toBe(false)

    isAdmin.value = true

    const adminView = await mountDirectory()

    expect(adminView.find('[data-testid="connector-registry-sync-now"]')
      .exists()).toBe(true)
  })
})
