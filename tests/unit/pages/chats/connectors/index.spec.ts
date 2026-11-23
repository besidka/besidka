import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import ConnectorsPage from '../../../../../app/pages/chats/connectors/index.vue'
import { CONNECTOR_CALLBACK_FALLBACK_MESSAGE } from '#shared/utils/connectors-messages'
import { createConnectorItem } from '../../../../setup/helpers/connectors-ui'
import { resolveGoogleEntries } from '../../../../../app/utils/google-entries'
import type { GoogleEntry } from '../../../../../app/utils/google-entries'
import type { GoogleConnectionStatusResponse } from '#shared/utils/google-connections'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  refreshConnectors: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  navigateTo: vi.fn(),
  setFeatureOptIn: vi.fn(),
  replace: vi.fn(),
  sidePanelOpen: vi.fn(),
  sidePanelClose: vi.fn(),
  refreshGoogle: vi.fn(),
  googlePanelOpen: vi.fn(),
  googleRun: vi.fn(),
  reportGoogleResult: vi.fn(),
  query: {} as Record<string, unknown>,
}))

const googleEntries = ref<GoogleEntry[]>([])
const googleAnnouncement = ref<string>('')
const googleStatus = ref<string>('success')

const queryRef = ref<Record<string, unknown>>({})
const connectorsActive = ref<boolean>(true)
const registryActive = ref<boolean>(false)
const besidkaEnabled = ref<boolean>(false)
const besidkaActive = ref<boolean>(false)
const data = ref<unknown>(null)
const fetchError = ref<unknown>(null)
const connectTarget = ref<string | null>(null)
const connectDraft = ref<Record<string, string> | null>(null)
const viewKey = ref<string | null>(null)

Object.defineProperty(mocks, 'query', {
  get: () => queryRef.value,
  set: (value: Record<string, unknown>) => {
    queryRef.value = value
  },
})

mockNuxtImport('useFeature', () => {
  return (flag: string) => computed(() => {
    if (flag === 'besidka-tools') {
      return {
        enabled: besidkaEnabled.value,
        active: besidkaActive.value,
        variant: null,
      }
    }

    const isActive = flag === 'connectors.registry'
      ? registryActive.value
      : connectorsActive.value

    return { enabled: isActive, active: isActive, variant: null }
  })
})
mockNuxtImport('useFeatureOptIn', () => {
  return () => ({ setFeatureOptIn: mocks.setFeatureOptIn })
})
mockNuxtImport('useConnectorsPage', () => {
  return () => ({
    connectors: computed(() => {
      return (data.value as { connectors: unknown[] } | null)?.connectors ?? []
    }),
    hasLoaded: computed(() => !!data.value),
    status: ref('success'),
    error: fetchError,
    refresh: mocks.refresh,
  })
})
mockNuxtImport('useConnectorConnect', () => {
  return () => ({
    targetId: connectTarget,
    draft: connectDraft,
    open: (id: string) => {
      connectDraft.value = null
      connectTarget.value = id
    },
    openDraft: (draft: Record<string, string>) => {
      connectTarget.value = null
      connectDraft.value = draft
    },
    close: () => {
      connectTarget.value = null
      connectDraft.value = null
    },
  })
})
mockNuxtImport('useSidePanel', () => {
  return () => ({
    open: mocks.sidePanelOpen,
    close: mocks.sidePanelClose,
    viewKey,
  })
})
mockNuxtImport('useGoogleEntries', () => {
  return () => ({
    entries: googleEntries,
    refresh: mocks.refreshGoogle,
    status: googleStatus,
    data: ref(null),
    isCalendarActive: ref(false),
  })
})
mockNuxtImport('useGoogleEntryPanel', () => {
  return () => ({ open: mocks.googlePanelOpen })
})
mockNuxtImport('useGoogleEntryActions', () => {
  return () => ({
    isBusy: ref(false),
    announcement: googleAnnouncement,
    run: mocks.googleRun,
  })
})
mockNuxtImport('reportGoogleConnectResult', () => mocks.reportGoogleResult)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useRoute', () => {
  return () => ({
    path: '/chats/connectors',
    get query() {
      return queryRef.value
    },
  })
})
mockNuxtImport('useRouter', (original) => {
  return () => {
    return new Proxy(original(), {
      get(target, property) {
        return property === 'replace'
          ? mocks.replace
          : Reflect.get(target, property)
      },
    })
  }
})

mockComponent('ProfileConnectorsAddDialog', () => {
  return {
    props: ['initialTab', 'addedPresetIds'],
    emits: ['picked'],
    template: `<div data-testid="add-dialog-stub">{{ initialTab }}
      <span data-testid="add-dialog-added">{{ [...addedPresetIds].join() }}</span>
      <button
        data-testid="add-dialog-pick-linear"
        @click="$emit('picked', { presetId: 'linear' })"
      />
    </div>`,
  }
})

mockComponent('ProfileConnectorsDirectory', () => {
  return {
    template: '<div data-testid="directory-stub">directory</div>',
  }
})

mockComponent('ProfileConnectorsConnectDialog', () => {
  return {
    props: ['connectorId', 'draft'],
    template: `<div data-testid="connect-dialog-stub">{{ connectorId }}
      <span data-testid="connect-dialog-draft">{{ JSON.stringify(draft) }}</span>
    </div>`,
  }
})

async function mountPage() {
  const wrapper = await mountSuspended(ConnectorsPage)

  await flushPromises()

  return wrapper
}

describe('chats connectors page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    connectorsActive.value = true
    registryActive.value = false
    besidkaEnabled.value = false
    besidkaActive.value = false
    data.value = { connectors: [] }
    fetchError.value = null
    connectTarget.value = null
    connectDraft.value = null
    viewKey.value = null
    googleEntries.value = []
    googleAnnouncement.value = ''
    googleStatus.value = 'success'
    mocks.query = {}
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function') {
        mock.mockReset()
      }
    }
    mocks.fetch.mockResolvedValue({})
    mocks.refreshConnectors.mockResolvedValue(undefined)
    mocks.setFeatureOptIn.mockResolvedValue(undefined)
  })

  it('shows a skeleton while loading and a retry on error', async () => {
    data.value = null

    const loading = await mountPage()

    expect(loading.find('[data-testid="connectors-skeleton"]').exists())
      .toBe(true)

    fetchError.value = new Error('boom')

    const failed = await mountPage()

    expect(failed.find('[data-testid="connectors-error"]').exists()).toBe(true)
  })

  it('offers presets and Add by URL when there is no connector', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="connectors-empty"]').exists()).toBe(true)

    await wrapper.get('[data-testid="connectors-empty-url"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="add-dialog-stub"]').text()).toBe('url')
  })

  it('lists connectors with their status, tools and the adding app',
    async () => {
      data.value = {
        connectors: [
          createConnectorItem({ enabled: true }),
          createConnectorItem({
            id: 'conn2',
            title: 'Notion',
            presetId: null,
            status: 'needs-auth',
            createdVia: 'mcp',
            addedByApp: 'Claude',
            tools: {
              isBaselined: false,
              total: 0,
              enabled: 0,
              alwaysAllowed: 0,
            },
          }),
          createConnectorItem({ id: 'conn3', status: 'drifted' }),
        ],
      }

      const wrapper = await mountPage()
      const rows = wrapper.findAll('[data-testid="connector-row"]')

      expect(rows).toHaveLength(3)
      expect(rows[0]!.get('[data-testid="connector-row-status"]').text())
        .toBe('Ready')
      expect(rows[0]!.get('[data-testid="connector-row-tools"]').text())
        .toBe('2 of 3 tools on')
      expect(rows[0]!.get('[data-testid="connector-avatar-image"]')
        .attributes('src')).toBe('/api/v1/connectors/conn1/icon')
      expect(rows[1]!.get('[data-testid="connector-avatar-image"]')
        .attributes('src')).toBe('/api/v1/connectors/conn2/icon')
      expect(rows[1]!.get('[data-testid="connector-row-added-by"]').text())
        .toBe('Added by Claude, not by you in the app')
      expect(rows[1]!.get('[data-testid="connector-row-mcp-badge"]').text())
        .toBe('Added by a connected app')
      expect(rows[0]!.find('[data-testid="connector-row-mcp-badge"]').exists())
        .toBe(false)
      expect(rows[1]!.find('[data-testid="connector-row-connect"]').exists())
        .toBe(true)
      expect(rows[2]!.find('[data-testid="connector-row-review"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="connectors-count"]').text())
        .toBe('3 of 20 connectors')
    })

  it('asks for the tool review instead of a switch before the first '
    + 'review', async () => {
    data.value = {
      connectors: [createConnectorItem({
        tools: { isBaselined: false, total: 0, enabled: 0, alwaysAllowed: 0 },
      })],
    }

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="connector-row-toggle"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="connector-row-review"]').trigger('click')

    expect(mocks.sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({
      viewKey: 'connector:conn1',
    }))
  })

  it('turns a connector on and refreshes the list', async () => {
    data.value = { connectors: [createConnectorItem()] }

    const wrapper = await mountPage()
    const toggle = wrapper.get('[data-testid="connector-row-toggle"]')

    ;(toggle.element as HTMLInputElement).checked = true
    await toggle.trigger('change')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/conn1', {
      method: 'PATCH',
      body: { enabled: true },
    })
    expect(mocks.refreshConnectors).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="connectors-live"]').text())
      .toBe('Linear turned on')
  })

  it('opens the detail panel from a row', async () => {
    data.value = { connectors: [createConnectorItem()] }

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="connector-row-open"]').trigger('click')

    expect(mocks.sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({
      viewKey: 'connector:conn1',
      title: 'Linear',
      props: { connectorId: 'conn1' },
    }))
  })

  it('shows a toast after the OAuth callback and opens the connector',
    async () => {
      data.value = { connectors: [createConnectorItem()] }
      mocks.query = { connected: 'conn1', keep: '1' }

      const wrapper = await mountPage()

      expect(mocks.success).toHaveBeenCalledWith('Connector signed in')
      expect(mocks.replace).toHaveBeenCalledWith({
        path: '/chats/connectors',
        query: { keep: '1' },
      })
      expect(mocks.sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({
        viewKey: 'connector:conn1',
      }))
      expect(wrapper.get('[data-testid="connectors-live"]').text())
        .toBe('Connector signed in')
    })

  it('opens the add dialog on the tab named by the add query and clears it', async () => {
    mocks.query = { add: 'directory', keep: '1' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="add-dialog-stub"]').text())
      .toBe('directory')
    expect(mocks.replace).toHaveBeenCalledWith({
      path: '/chats/connectors',
      query: { keep: '1' },
    })
  })

  it('ignores an unknown add query value', async () => {
    mocks.query = { add: 'bogus' }

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="add-dialog-stub"]').exists())
      .toBe(false)
    expect(mocks.replace).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/chats/connectors' }),
    )
  })

  it('maps a callback error code to a fixed message and never shows the '
    + 'raw value', async () => {
    mocks.query = { error: 'CONNECTOR_OAUTH_DENIED' }
    await mountPage()

    expect(mocks.error).toHaveBeenCalledWith('Sign-in was canceled')

    mocks.query = { error: '<b>Call +1 555 support</b>' }

    const wrapper = await mountPage()

    expect(mocks.error).toHaveBeenLastCalledWith(
      CONNECTOR_CALLBACK_FALLBACK_MESSAGE,
    )
    expect(wrapper.html()).not.toContain('555')
  })

  it('opens the Connect dialog after adding a connector', async () => {
    data.value = { connectors: [createConnectorItem({ status: 'needs-auth' })] }

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="connector-row-connect"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="connect-dialog-stub"]').text())
      .toBe('conn1')
  })

  it('opens the Connect dialog with a draft that stores nothing', async () => {
    data.value = { connectors: [] }

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="connectors-empty-presets"]')
      .trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="add-dialog-pick-linear"]')
      .trigger('click')
    await flushPromises()

    expect(JSON.parse(
      wrapper.get('[data-testid="connect-dialog-draft"]').text(),
    )).toEqual({ presetId: 'linear' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reopens the connector that never connected instead of adding a '
    + 'second one, and does not count it as added', async () => {
    data.value = {
      connectors: [createConnectorItem({
        status: 'needs-auth',
        lastConnectedAt: null,
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })],
    }

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="connectors-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="add-dialog-added"]').text()).toBe('')

    await wrapper.get('[data-testid="add-dialog-pick-linear"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="connect-dialog-stub"]').text())
      .toContain('conn1')
  })

  it('counts a connected preset as added', async () => {
    data.value = { connectors: [createConnectorItem()] }

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="connectors-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="add-dialog-added"]').text())
      .toBe('linear')
  })

  it('offers Finish connecting and Remove for a row that never connected',
    async () => {
      data.value = {
        connectors: [createConnectorItem({
          status: 'needs-auth',
          lastConnectedAt: null,
          consent: { state: 'missing', issuerHost: null, givenAt: null },
        })],
      }

      const wrapper = await mountPage()

      expect(wrapper.get('[data-testid="connector-row-status"]').text())
        .toBe('Not connected')
      expect(wrapper.get('[data-testid="connector-row-connect"]').text())
        .toBe('Finish connecting')

      await wrapper.get('[data-testid="connector-row-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/delete/bulk',
        { method: 'POST', body: { ids: ['conn1'] } },
      )
      expect(mocks.refreshConnectors).toHaveBeenCalled()
    })

  it('leaves the page when the connectors flag is off', async () => {
    connectorsActive.value = false
    await mountPage()

    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/history', {
      replace: true,
    })
  })

  it.each([
    ['google', { google: 'connected' }],
    ['google-byo', { 'google-byo': 'partial' }],
  ])('sends a user without the flag to the Google keys tab with ?%s',
    async (_key, query) => {
      connectorsActive.value = false
      mocks.query = { ...query, panel: 'google-drive', other: '1' }
      await mountPage()

      expect(mocks.navigateTo).toHaveBeenCalledWith({
        path: '/profile/keys',
        query: { tab: 'google', ...query },
      }, { replace: true })
    })

  it('keeps both Google result keys when a user without the flag has them',
    async () => {
      connectorsActive.value = false
      mocks.query = { 'google': 'connected', 'google-byo': 'error' }
      await mountPage()

      expect(mocks.navigateTo).toHaveBeenCalledWith({
        path: '/profile/keys',
        query: { 'tab': 'google', 'google': 'connected', 'google-byo': 'error' },
      }, { replace: true })
    })

  it('sends a user without the flag to history for any other query',
    async () => {
      connectorsActive.value = false
      mocks.query = { panel: 'google-drive' }
      await mountPage()

      expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/history', {
        replace: true,
      })
    })

  it('renders inside the history shell with the Connectors tab active', async () => {
    const wrapper = await mountPage()
    const tab = wrapper.get('[data-testid="tab-connectors"]')

    expect(tab.attributes('aria-current')).toBe('page')
    expect(tab.attributes('to')).toBe('/chats/connectors')
  })

  describe('Besidka row', () => {
    const rowSelector = '[data-testid="besidka-connector-row"]'
    const toggleSelector = '[data-testid="besidka-connector-row-toggle"]'

    it('is not shown without access to the besidka-tools flag', async () => {
      data.value = { connectors: [createConnectorItem()] }

      const wrapper = await mountPage()

      expect(wrapper.find(rowSelector).exists()).toBe(false)
    })

    it('is pinned above the connectors with no delete, mode or status',
      async () => {
        besidkaEnabled.value = true
        besidkaActive.value = true
        data.value = { connectors: [createConnectorItem()] }

        const wrapper = await mountPage()
        const items = wrapper.findAll(
          '[data-testid="connectors-list"] > li',
        )
        const row = wrapper.get(rowSelector)

        expect(items[0]!.attributes('data-testid'))
          .toBe('besidka-connector-row')
        expect(items).toHaveLength(2)
        expect(row.text()).toContain('Besidka')
        expect(row.find('[data-testid="connector-row-remove"]').exists())
          .toBe(false)
        expect(row.find('[data-testid="connector-row-mode"]').exists())
          .toBe(false)
        expect(row.find('[data-testid="connector-row-status"]').exists())
          .toBe(false)
        expect(wrapper.get('[data-testid="connectors-count"]').text())
          .toBe('1 of 20 connectors')
      })

    it('shows above the empty state when there are no connectors',
      async () => {
        besidkaEnabled.value = true
        besidkaActive.value = true

        const wrapper = await mountPage()

        expect(wrapper.find(rowSelector).exists()).toBe(true)
        expect(wrapper.find('[data-testid="connectors-empty"]').exists())
          .toBe(true)
        expect(wrapper.get('[data-testid="connectors-count"]').text())
          .toBe('0 of 20 connectors')
      })

    it('has a switch that is off while the opt-in is off', async () => {
      besidkaEnabled.value = true

      const wrapper = await mountPage()
      const toggle = wrapper.get(toggleSelector)

      expect((toggle.element as HTMLInputElement).checked).toBe(false)
      expect(wrapper.find('[data-testid="besidka-connector-row-open"]')
        .exists()).toBe(false)
    })

    it('turns the Labs opt-in on and off through the shared writer',
      async () => {
        besidkaEnabled.value = true
        mocks.setFeatureOptIn.mockImplementation(async (_key, enabled) => {
          besidkaActive.value = enabled
        })

        const wrapper = await mountPage()
        const toggle = wrapper.get(toggleSelector)
        const input = toggle.element as HTMLInputElement

        input.checked = true
        await toggle.trigger('change')
        await flushPromises()

        expect(mocks.setFeatureOptIn)
          .toHaveBeenCalledWith('besidka-tools', true)
        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(input.checked).toBe(true)
        expect(wrapper.find('[data-testid="besidka-connector-row-open"]')
          .exists()).toBe(true)
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('Besidka tools turned on')

        input.checked = false
        await toggle.trigger('change')
        await flushPromises()

        expect(mocks.setFeatureOptIn)
          .toHaveBeenLastCalledWith('besidka-tools', false)
        expect(input.checked).toBe(false)
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('Besidka tools turned off')
      })

    it('does not announce a change the refreshed state does not show',
      async () => {
        besidkaEnabled.value = true

        const wrapper = await mountPage()
        const toggle = wrapper.get(toggleSelector)

        ;(toggle.element as HTMLInputElement).checked = true
        await toggle.trigger('change')
        await flushPromises()

        expect(mocks.setFeatureOptIn).toHaveBeenCalled()
        expect(mocks.error).toHaveBeenCalledWith(
          'Besidka tools may not have updated',
          expect.stringContaining('Reload the page'),
        )
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('')
        expect((toggle.element as HTMLInputElement).checked).toBe(false)
      })

    it('closes the open panel when the opt-in is turned off', async () => {
      besidkaEnabled.value = true
      besidkaActive.value = true
      viewKey.value = 'besidka-tool-permissions'
      mocks.setFeatureOptIn.mockImplementation(async (_key, enabled) => {
        besidkaActive.value = enabled
      })

      const wrapper = await mountPage()
      const toggle = wrapper.get(toggleSelector)

      ;(toggle.element as HTMLInputElement).checked = false
      await toggle.trigger('change')
      await flushPromises()

      expect(mocks.sidePanelClose).toHaveBeenCalledTimes(1)
    })

    it('leaves another open panel alone when the opt-in is turned off',
      async () => {
        besidkaEnabled.value = true
        besidkaActive.value = true
        viewKey.value = 'connector:conn1'
        mocks.setFeatureOptIn.mockImplementation(async (_key, enabled) => {
          besidkaActive.value = enabled
        })

        const wrapper = await mountPage()
        const toggle = wrapper.get(toggleSelector)

        ;(toggle.element as HTMLInputElement).checked = false
        await toggle.trigger('change')
        await flushPromises()

        expect(mocks.sidePanelClose).not.toHaveBeenCalled()
      })

    it('closes its panel when the page is left', async () => {
      besidkaEnabled.value = true
      besidkaActive.value = true
      viewKey.value = 'besidka-tool-permissions'

      const wrapper = await mountPage()

      wrapper.unmount()

      expect(mocks.sidePanelClose).toHaveBeenCalled()
    })

    it('opens the panel again when the panel query changes on the page',
      async () => {
        besidkaEnabled.value = true
        besidkaActive.value = true

        await mountPage()

        expect(mocks.sidePanelOpen).not.toHaveBeenCalled()

        mocks.query = { panel: 'besidka-tool-permissions' }
        await flushPromises()

        expect(mocks.sidePanelOpen).toHaveBeenCalledWith(
          expect.objectContaining({ viewKey: 'besidka-tool-permissions' }),
        )
        expect(mocks.replace).toHaveBeenCalledWith({
          path: '/chats/connectors',
          query: {},
        })
      })

    it('reports a failed save and leaves the switch alone', async () => {
      besidkaEnabled.value = true
      mocks.setFeatureOptIn.mockRejectedValue(new Error('nope'))

      const wrapper = await mountPage()
      const toggle = wrapper.get(toggleSelector)

      ;(toggle.element as HTMLInputElement).checked = true
      await toggle.trigger('change')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalled()
      expect((toggle.element as HTMLInputElement).checked).toBe(false)
    })

    it('opens the tool permissions panel from the row', async () => {
      besidkaEnabled.value = true
      besidkaActive.value = true

      const wrapper = await mountPage()

      await wrapper.get('[data-testid="besidka-connector-row-open"]')
        .trigger('click')

      expect(mocks.sidePanelOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          viewKey: 'besidka-tool-permissions',
          title: 'Tool permissions',
        }),
      )
    })

    it('opens the panel from the panel query and clears it', async () => {
      besidkaEnabled.value = true
      besidkaActive.value = true
      mocks.query = { panel: 'besidka-tool-permissions', keep: '1' }

      await mountPage()

      expect(mocks.sidePanelOpen).toHaveBeenCalledWith(
        expect.objectContaining({ viewKey: 'besidka-tool-permissions' }),
      )
      expect(mocks.replace).toHaveBeenCalledWith({
        path: '/chats/connectors',
        query: { keep: '1' },
      })
    })

    it('does not open the panel from the query while the opt-in is off',
      async () => {
        besidkaEnabled.value = true
        mocks.query = { panel: 'besidka-tool-permissions' }

        await mountPage()

        expect(mocks.sidePanelOpen).not.toHaveBeenCalled()
      })
  })

  describe('with the directory', () => {
    beforeEach(() => {
      registryActive.value = true
    })

    it('shows Yours and Discover, and Discover shows the directory', async () => {
      data.value = { connectors: [createConnectorItem()] }

      const wrapper = await mountPage()

      expect(wrapper.find('[data-testid="connectors-view-filter"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="connector-row"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="directory-stub"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="connectors-view-discover"]')
        .trigger('change')
      await flushPromises()

      expect(wrapper.find('[data-testid="directory-stub"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="connector-row"]').exists())
        .toBe(false)
      expect(mocks.replace).toHaveBeenCalledWith({
        path: '/chats/connectors',
        query: { tab: 'discover' },
      })
    })

    it('makes Add connector the primary button and opens Discover', async () => {
      data.value = { connectors: [createConnectorItem()] }

      const wrapper = await mountPage()
      const add = wrapper.get('[data-testid="connectors-add"]')

      expect(add.classes()).toContain('btn-primary')
      expect(wrapper.get('[data-testid="connectors-add-url"]').classes())
        .not.toContain('btn-primary')

      await add.trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="directory-stub"]').exists())
        .toBe(true)
    })

    it('opens Discover for the tab query and the old add links', async () => {
      for (const query of [
        { tab: 'discover' },
        { add: 'directory' },
        { add: 'presets' },
      ]) {
        mocks.query = query

        const wrapper = await mountPage()

        expect(wrapper.find('[data-testid="directory-stub"]').exists())
          .toBe(true)
        expect(wrapper.find('[data-testid="add-dialog-stub"]').exists())
          .toBe(false)
      }
    })

    it('still opens the address form for the url add link', async () => {
      mocks.query = { add: 'url' }

      const wrapper = await mountPage()

      expect(wrapper.get('[data-testid="add-dialog-stub"]').text()).toBe('url')
    })
  })

  describe('Google entries', () => {
    const rowSelector = '[data-testid="besidka-connector-row"]'

    function setGoogleEntries(
      status: Partial<GoogleConnectionStatusResponse> = {},
      isGmailActive = true,
    ) {
      googleEntries.value = resolveGoogleEntries({
        status: {
          connection: null,
          canConnect: true,
          dedicatedClient: true,
          byo: {
            canManage: true,
            redirectUri: 'https://besidka.com/api/v1/google/byo/callback',
            hasClient: true,
            connection: null,
          },
          ...status,
        },
        driveFeature: { enabled: true, active: true },
        isGmailActive,
        isCalendarActive: true,
      })
    }

    it('lists the Google group under Besidka and above the connectors',
      async () => {
        besidkaEnabled.value = true
        besidkaActive.value = true
        setGoogleEntries()
        data.value = { connectors: [createConnectorItem()] }

        const wrapper = await mountPage()
        const items = wrapper.findAll('[data-testid="connectors-list"] > li')
        const group = wrapper.get('[data-testid="connectors-google-group"]')

        expect(items.map(item => item.attributes('data-testid'))).toEqual([
          'besidka-connector-row',
          'connectors-google-group',
          'connector-row',
        ])
        expect(group.get('h3').classes()).toContain('sr-only')
        expect(group.get('h3').text()).toBe('Google')
        expect(group.findAll('[data-testid^="google-entry-row-"][class*="list-row"]')
          .map(row => row.attributes('data-testid'))).toEqual([
          'google-entry-row-google-drive',
          'google-entry-row-google-gmail',
          'google-entry-row-google-calendar',
        ])
        expect(wrapper.find(rowSelector).exists()).toBe(true)
        expect(wrapper.get('[data-testid="connectors-count"]').text())
          .toBe('1 of 20 connectors')
      })

    it('shows only Google Drive for a user without the own client',
      async () => {
        setGoogleEntries({ byo: null })

        const wrapper = await mountPage()

        expect(wrapper.findAll('[data-testid="google-entry-row-open"]')
          .map(button => button.text())).toEqual(['Google Drive'])
      })

    it('shows the group above the empty state and without connectors',
      async () => {
        setGoogleEntries({ byo: null })

        const wrapper = await mountPage()

        expect(wrapper.find('[data-testid="connectors-google-group"]')
          .exists()).toBe(true)
        expect(wrapper.find('[data-testid="connectors-empty"]').exists())
          .toBe(true)
      })

    it('has no Google group while nothing is listed', async () => {
      data.value = { connectors: [createConnectorItem()] }

      const wrapper = await mountPage()

      expect(wrapper.find('[data-testid="connectors-google-group"]')
        .exists()).toBe(false)
    })

    it('shows one row with Try again when the Google status failed to load',
      async () => {
        googleStatus.value = 'error'

        const wrapper = await mountPage()
        const group = wrapper.get('[data-testid="connectors-google-group"]')
        const retry = group.get('[data-testid="connectors-google-retry"]')

        expect(group.findAll('[data-testid="connectors-google-error"]'))
          .toHaveLength(1)
        expect(group.get('[data-testid="connectors-google-error"]').text())
          .toContain('Google services could not be loaded')
        expect(retry.element.tagName).toBe('BUTTON')
        expect(retry.text()).toBe('Try again')
        expect(retry.classes()).toContain('min-h-11')
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('Google services could not be loaded')
        expect(wrapper.get('[data-testid="connectors-live"]')
          .attributes('aria-live')).toBe('polite')

        await retry.trigger('click')

        expect(mocks.refreshGoogle).toHaveBeenCalledTimes(1)
      })

    it('shows no failure row when the Google status loaded or entries exist',
      async () => {
        const loaded = await mountPage()

        expect(loaded.find('[data-testid="connectors-google-error"]')
          .exists()).toBe(false)

        googleStatus.value = 'error'
        setGoogleEntries({ byo: null })

        const stale = await mountPage()

        expect(stale.find('[data-testid="connectors-google-error"]')
          .exists()).toBe(false)
      })

    it('never gives a connector titled Gmail the Built in badge',
      async () => {
        data.value = {
          connectors: [createConnectorItem({ title: 'Gmail' })],
        }

        const wrapper = await mountPage()
        const row = wrapper.get('[data-testid="connector-row"]')

        expect(row.text()).toContain('Gmail')
        expect(row.text()).not.toContain('Built in')
        expect(wrapper.find('[data-testid="google-entry-row-badge"]').exists())
          .toBe(false)
      })

    it('opens the panel from a row and runs its action', async () => {
      setGoogleEntries()
      googleAnnouncement.value = 'Google Drive disconnected.'

      const wrapper = await mountPage()
      const gmailRow = wrapper.get(
        '[data-testid="google-entry-row-google-gmail"]',
      )

      await gmailRow.get('[data-testid="google-entry-row-open"]')
        .trigger('click')

      expect(mocks.googlePanelOpen).toHaveBeenCalledWith('google-gmail')

      await gmailRow.get('[data-testid="google-entry-row-action"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.googleRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'google-gmail', action: 'connect' }),
      )
      expect(wrapper.get('[data-testid="connectors-live"]').text())
        .toBe('Google Drive disconnected.')
    })

    it('marks the row whose panel is open', async () => {
      setGoogleEntries()
      viewKey.value = 'google-entry:google-gmail'

      const wrapper = await mountPage()

      expect(wrapper.get('[data-testid="google-entry-row-google-gmail"]')
        .classes()).toContain('bg-base-200')
      expect(wrapper.get('[data-testid="google-entry-row-google-drive"]')
        .classes()).not.toContain('bg-base-200')
    })

    it.each([
      ['google-drive'],
      ['google-gmail'],
      ['google-calendar'],
    ])('opens the %s panel for the panel query and cleans the URL',
      async (panel) => {
        mocks.query = { panel, keep: '1' }

        await mountPage()

        expect(mocks.googlePanelOpen).toHaveBeenCalledWith(panel)
        expect(mocks.replace).toHaveBeenCalledWith({
          path: '/chats/connectors',
          query: { keep: '1' },
        })
      })

    it('ignores an unknown panel value', async () => {
      mocks.query = { panel: 'google-evil' }

      await mountPage()

      expect(mocks.googlePanelOpen).not.toHaveBeenCalled()
    })

    it('reports a Google Drive result, refreshes and opens the Drive panel',
      async () => {
        mocks.query = { google: 'connected', keep: '1' }

        const wrapper = await mountPage()

        expect(mocks.reportGoogleResult)
          .toHaveBeenCalledWith('besidka', 'connected')
        expect(mocks.refreshGoogle).toHaveBeenCalled()
        expect(mocks.googlePanelOpen).toHaveBeenCalledWith('google-drive')
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('Google Drive connected')
        expect(mocks.replace).toHaveBeenCalledWith({
          path: '/chats/connectors',
          query: { keep: '1' },
        })
      })

    it('reports an own-client result and opens the panel it came from',
      async () => {
        mocks.query = { 'google-byo': 'partial', 'panel': 'google-calendar' }

        const wrapper = await mountPage()

        expect(mocks.reportGoogleResult)
          .toHaveBeenCalledWith('byo', 'partial')
        expect(mocks.refreshGoogle).toHaveBeenCalled()
        expect(mocks.googlePanelOpen).toHaveBeenCalledWith('google-calendar')
        expect(wrapper.get('[data-testid="connectors-live"]').text())
          .toBe('Google granted only part of the access')
        expect(mocks.replace).toHaveBeenCalledWith({
          path: '/chats/connectors',
          query: {},
        })
      })

    it('opens the Gmail panel for an own-client result without a panel',
      async () => {
        mocks.query = { 'google-byo': 'denied' }

        await mountPage()

        expect(mocks.googlePanelOpen).toHaveBeenCalledWith('google-gmail')
        expect(mocks.refreshGoogle).not.toHaveBeenCalled()
      })

    it('ignores a result value it does not know', async () => {
      mocks.query = { google: 'bogus' }

      await mountPage()

      expect(mocks.reportGoogleResult).not.toHaveBeenCalled()
      expect(mocks.googlePanelOpen).not.toHaveBeenCalled()
    })

    it('closes its panel when the page unmounts', async () => {
      viewKey.value = 'google-entry:google-drive'

      const wrapper = await mountPage()

      wrapper.unmount()

      expect(mocks.sidePanelClose).toHaveBeenCalled()
    })
  })
})
