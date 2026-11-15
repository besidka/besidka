import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import ConnectorsPage from '../../../../app/pages/profile/connectors.vue'
import { CONNECTOR_CALLBACK_FALLBACK_MESSAGE } from '#shared/utils/connectors-messages'
import { createConnectorItem } from '../../../setup/helpers/connectors-ui'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  refreshConnectors: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  navigateTo: vi.fn(),
  replace: vi.fn(),
  sidePanelOpen: vi.fn(),
  sidePanelClose: vi.fn(),
  query: {} as Record<string, unknown>,
}))

const connectorsActive = ref<boolean>(true)
const data = ref<unknown>(null)
const fetchError = ref<unknown>(null)
const connectTarget = ref<string | null>(null)
const viewKey = ref<string | null>(null)

mockNuxtImport('useFeature', () => {
  return () => computed(() => ({
    enabled: connectorsActive.value,
    active: connectorsActive.value,
    variant: null,
  }))
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
    open: (id: string) => {
      connectTarget.value = id
    },
    close: () => {
      connectTarget.value = null
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
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useRoute', () => {
  return () => ({ path: '/profile/connectors', query: mocks.query })
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
    props: ['initialTab'],
    template: '<div data-testid="add-dialog-stub">{{ initialTab }}</div>',
  }
})

mockComponent('ProfileConnectorsConnectDialog', () => {
  return {
    props: ['connectorId'],
    template: '<div data-testid="connect-dialog-stub">{{ connectorId }}</div>',
  }
})

async function mountPage() {
  const wrapper = await mountSuspended(ConnectorsPage)

  await flushPromises()

  return wrapper
}

describe('profile connectors page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    connectorsActive.value = true
    data.value = { connectors: [] }
    fetchError.value = null
    connectTarget.value = null
    viewKey.value = null
    mocks.query = {}
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function') {
        mock.mockReset()
      }
    }
    mocks.fetch.mockResolvedValue({})
    mocks.refreshConnectors.mockResolvedValue(undefined)
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
      expect(rows[0]!.get('[data-testid="connector-avatar"]').text()).toBe('L')
      expect(rows[1]!.get('[data-testid="connector-row-added-by"]').text())
        .toBe('Added by Claude, not by you in the app')
      expect(rows[1]!.find('[data-testid="connector-row-connect"]').exists())
        .toBe(true)
      expect(rows[2]!.find('[data-testid="connector-row-review"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="connectors-count"]').text())
        .toBe('3 of 20 connectors')
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
        path: '/profile/connectors',
        query: { keep: '1' },
      })
      expect(mocks.sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({
        viewKey: 'connector:conn1',
      }))
      expect(wrapper.get('[data-testid="connectors-live"]').text())
        .toBe('Connector signed in')
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

  it('leaves the page when the connectors flag is off', async () => {
    connectorsActive.value = false
    await mountPage()

    expect(mocks.navigateTo).toHaveBeenCalledWith('/profile/security', {
      replace: true,
    })
  })
})
