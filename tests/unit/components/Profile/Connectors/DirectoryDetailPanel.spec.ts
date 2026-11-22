import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import DirectoryDetailPanel from '../../../../../app/components/Profile/Connectors/DirectoryDetailPanel.vue'
import type {
  ConnectorDirectoryItem,
  ConnectorDirectoryProbe,
  ConnectorPageItem,
} from '#shared/types/connectors.d'
import {
  createConnectorItem,
  createDirectoryItem,
} from '../../../../setup/helpers/connectors-ui'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  openAdded: vi.fn(),
  connectOpen: vi.fn(),
  sidePanelClose: vi.fn(),
  loadProbe: vi.fn(),
  refreshEntry: vi.fn(),
}))

const entryData = ref<{
  item: ConnectorDirectoryItem
  categoryLabel: string
  probe: ConnectorDirectoryProbe | null
} | null>(null)
const probeData = ref<ConnectorDirectoryProbe | null>(null)
const connectors = ref<ConnectorPageItem[]>([])

mockNuxtImport('useLazyFetch', () => {
  return (url: string) => {
    return url.endsWith('/tools')
      ? { data: probeData, execute: mocks.loadProbe }
      : { data: entryData, error: ref(null), refresh: mocks.refreshEntry }
  }
})
mockNuxtImport('useSidePanel', () => () => ({ close: mocks.sidePanelClose }))
mockNuxtImport('useConnectorConnect', () => () => ({
  targetId: ref(null),
  open: mocks.connectOpen,
  close: vi.fn(),
}))
mockNuxtImport('useConnectorsPage', () => () => ({
  connectors: computed(() => connectors.value),
}))
mockNuxtImport('useConnectorDirectoryActions', () => () => ({
  add: mocks.add,
  openAdded: mocks.openAdded,
  openEntry: vi.fn(),
}))

function probe(patch: Partial<ConnectorDirectoryProbe> = {}) {
  return {
    authKind: 'none',
    state: 'listed',
    tools: [{ name: 'search', title: null, description: 'Find issues' }],
    checkedAt: '2026-11-16T00:00:00.000Z',
    ...patch,
  } as ConnectorDirectoryProbe
}

async function mountPanel() {
  const item = createDirectoryItem()
  const wrapper = await mountSuspended(DirectoryDetailPanel, {
    props: { entryId: item.id, initialItem: item },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Connectors/DirectoryDetailPanel', () => {
  beforeEach(() => {
    entryData.value = {
      item: createDirectoryItem(),
      categoryLabel: 'Project management',
      probe: null,
    }
    probeData.value = null
    connectors.value = []
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
  })

  it('shows the details as plain text, the Community badge and a primary Add', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.get('[data-testid="connector-directory-detail-title"]')
      .text()).toBe('Tracker')
    expect(wrapper.get('[data-testid="connector-directory-detail-publisher"]')
      .text()).toBe('by example.io')
    expect(wrapper.get('[data-testid="connector-directory-detail-url"]')
      .text()).toBe('https://mcp.tracker.example.com/mcp')
    expect(wrapper.get('[data-testid="connector-directory-detail-category"]')
      .text()).toBe('Project management')

    expect(wrapper.get('[data-testid="connector-directory-detail-community"]')
      .text()).toBe('Community')
    expect(wrapper.find('[data-testid="connector-directory-detail-featured"]')
      .exists()).toBe(false)

    const primary = wrapper
      .get('[data-testid="connector-directory-detail-primary"]')

    expect(primary.classes()).toContain('btn-primary')
    expect(primary.text()).toContain('Add and connect')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('shows no Add and connect for a server whose sign-in refuses Besidka', async () => {
    entryData.value = {
      item: createDirectoryItem({
        title: 'Vercel',
        host: 'mcp.vercel.com',
        remoteUrl: 'https://mcp.vercel.com/',
      }),
      categoryLabel: 'Cloud & infrastructure',
      probe: null,
    }

    const wrapper = await mountPanel()

    expect(wrapper.find('[data-testid="connector-directory-detail-primary"]')
      .exists()).toBe(false)
    expect(wrapper.get('[data-testid="connector-directory-detail-unavailable"]')
      .text()).toBe('Sign-in not available for Besidka yet')
  })

  it('probes the tools on open and lists them', async () => {
    const wrapper = await mountPanel()

    entryData.value = { ...entryData.value! }
    await flushPromises()

    expect(mocks.loadProbe).toHaveBeenCalled()

    probeData.value = probe()
    await flushPromises()

    expect(wrapper.get('[data-testid="connector-directory-detail-tool-list"]')
      .text()).toContain('Find issues')
    expect(wrapper.get('[data-testid="connector-directory-detail-auth"]')
      .text()).toBe('No sign-in needed')
  })

  it('says tools come after connecting when the server needs a sign-in', async () => {
    entryData.value!.probe = probe({
      authKind: 'oauth',
      state: 'needs-auth',
      tools: [],
    })

    const wrapper = await mountPanel()

    expect(wrapper.get('[data-testid="connector-directory-detail-tools-later"]')
      .text()).toBe('Tools are listed after you connect.')
    expect(wrapper.get('[data-testid="connector-directory-detail-auth"]')
      .text()).toBe('Sign in with your account')
    expect(mocks.loadProbe).not.toHaveBeenCalled()
  })

  it('starts adding the entry without storing anything', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('[data-testid="connector-directory-detail-primary"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'io.example/tracker@1.0.0' }),
    )
    expect(mocks.refreshEntry).not.toHaveBeenCalled()
  })

  it('refreshes the entry once a connector gets connected', async () => {
    entryData.value!.item = createDirectoryItem({ addedConnectorId: 'conn1' })
    connectors.value = [createConnectorItem({
      status: 'needs-auth',
      lastConnectedAt: null,
      consent: { state: 'missing', issuerHost: null, givenAt: null },
    })]

    const wrapper = await mountPanel()

    expect(wrapper
      .get('[data-testid="connector-directory-detail-primary"]').text())
      .toBe('Connect')
    expect(mocks.refreshEntry).not.toHaveBeenCalled()

    connectors.value = [createConnectorItem()]
    await flushPromises()

    expect(mocks.refreshEntry).toHaveBeenCalled()
  })

  it('offers Open for an added connector and Connect for one not signed in', async () => {
    entryData.value!.item = createDirectoryItem({
      isAdded: true,
      addedConnectorId: 'conn1',
    })
    connectors.value = [createConnectorItem()]

    const wrapper = await mountPanel()
    const primary = wrapper
      .get('[data-testid="connector-directory-detail-primary"]')

    expect(primary.text()).toBe('Open')

    await primary.trigger('click')

    expect(mocks.openAdded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn1' }),
    )

    connectors.value = [createConnectorItem({ status: 'needs-auth' })]
    await flushPromises()

    expect(primary.text()).toBe('Connect')

    await primary.trigger('click')

    expect(mocks.connectOpen).toHaveBeenCalledWith('conn1')
  })

  it('marks a curated entry as Featured with its tooltip', async () => {
    entryData.value!.item = createDirectoryItem({ isCurated: true })

    const wrapper = await mountPanel()
    const featured = wrapper
      .get('[data-testid="connector-directory-detail-featured"]')

    expect(featured.text()).toBe('Featured')
    expect(featured.attributes('aria-label'))
      .toContain('Picked by Besidka as a well-known service')
    expect(wrapper.find('[data-testid="connector-directory-detail-community"]')
      .exists()).toBe(false)
  })

  it('goes back to the list', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('[data-testid="connector-directory-detail-back"]')
      .trigger('click')

    expect(mocks.sidePanelClose).toHaveBeenCalled()
  })
})
