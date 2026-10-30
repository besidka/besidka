import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ConnectedAppsPage from '../../../../app/pages/profile/connected-apps.vue'

const mocks = vi.hoisted(() => ({
  lazyFetch: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.lazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

function createApp(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    name: 'Claude',
    scopes: ['openid', 'chats:read', 'data:delete'],
    canEditScopes: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}

async function mountPage(apps: Array<Record<string, unknown>>) {
  mocks.lazyFetch.mockReturnValue({
    data: ref(apps),
    status: ref('success'),
    refresh: mocks.refresh,
  })

  return mountSuspended(ConnectedAppsPage)
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('profile connected apps page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.lazyFetch.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Disconnect' })
    mocks.fetch.mockReset().mockResolvedValue(undefined)
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('shows the empty state without apps', async () => {
    const wrapper = await mountPage([])

    expect(wrapper.find('[data-testid="connected-apps-empty"]').exists())
      .toBe(true)
  })

  it('renders the scope badges of an app without identity scopes', async () => {
    const wrapper = await mountPage([createApp()])
    const text = wrapper.get('[data-testid="connected-apps-list"]').text()

    expect(text).toContain('Read your chats')
    expect(text).toContain('Delete your data')
    expect(text).not.toContain('openid')
    expect(wrapper.find('[data-testid="connected-apps-duplicates-note"]')
      .exists()).toBe(false)
  })

  it('offers Edit permissions only for an app whose consent can be edited',
    async () => {
      const wrapper = await mountPage([
        createApp({ clientId: 'editable' }),
        createApp({
          clientId: 'read-only',
          name: 'Cursor',
          canEditScopes: false,
        }),
        createApp({
          clientId: 'identity-only',
          name: 'Zed',
          scopes: ['openid'],
        }),
      ])

      expect(wrapper.find('[data-testid="connected-apps-edit-editable"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="connected-apps-edit-read-only"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="connected-apps-edit-identity-only"]')
        .exists()).toBe(false)
    })

  it('opens the editor with only the granted scopes and the reconnect hint',
    async () => {
      const wrapper = await mountPage([createApp()])

      await wrapper.get('[data-testid="connected-apps-edit-client-1"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="oauth-scope-chats:read"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="oauth-scope-memory:read"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="connected-apps-add-hint"]').text())
        .toContain('reconnect this app from the app itself')
    })

  it('refreshes the list after the editor saves', async () => {
    const wrapper = await mountPage([createApp()])

    await wrapper.get('[data-testid="connected-apps-edit-client-1"]')
      .trigger('click')
    await wrapper.get('[data-testid="oauth-scope-data:delete"]')
      .setValue(false)
    await wrapper.get('[data-testid="connected-apps-editor-save"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/connected-apps/client-1/scopes',
      { method: 'PATCH', body: { scopes: ['chats:read'] } },
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="connected-apps-editor-client-1"]')
      .exists()).toBe(false)
  })

  it('groups connections of the same name with the reconnect note',
    async () => {
      const wrapper = await mountPage([
        createApp({
          clientId: 'old',
          createdAt: '2026-09-01T00:00:00.000Z',
          lastUsedAt: '2026-09-02T00:00:00.000Z',
        }),
        createApp({
          clientId: 'recent',
          name: 'claude',
          createdAt: '2026-10-01T00:00:00.000Z',
          lastUsedAt: '2026-10-20T00:00:00.000Z',
        }),
        createApp({ clientId: 'other', name: 'Cursor' }),
      ])

      expect(wrapper.findAll('[data-testid="connected-apps-duplicates-note"]'))
        .toHaveLength(1)
      expect(wrapper.get('[data-testid="connected-apps-duplicates-note"]')
        .text()).toContain('registers a new connection each time you reconnect')
      expect(wrapper.findAll('[data-testid="connected-apps-newest"]'))
        .toHaveLength(1)
    })

  it('disconnects every connection but the most recent one after confirming',
    async () => {
      const wrapper = await mountPage([
        createApp({
          clientId: 'old-1',
          createdAt: '2026-08-01T00:00:00.000Z',
        }),
        createApp({
          clientId: 'recent',
          createdAt: '2026-10-01T00:00:00.000Z',
          lastUsedAt: '2026-10-20T00:00:00.000Z',
        }),
        createApp({
          clientId: 'old-2',
          createdAt: '2026-09-01T00:00:00.000Z',
        }),
      ])

      await wrapper.get('[data-testid="connected-apps-disconnect-older"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Disconnect 2 older connections of Claude?',
      }))
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/connected-apps/revoke/bulk',
        { method: 'post', body: { clientIds: ['old-2', 'old-1'] } },
      )
      expect(mocks.refresh).toHaveBeenCalled()
    })

  it('does nothing when disconnecting older connections is declined',
    async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountPage([
        createApp({ clientId: 'a' }),
        createApp({ clientId: 'b', createdAt: '2026-10-02T00:00:00.000Z' }),
      ])

      await wrapper.get('[data-testid="connected-apps-disconnect-older"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
    })

  it('sends at most 20 client ids per bulk request', async () => {
    const apps = Array.from({ length: 23 }, (_value, index) => {
      return createApp({
        clientId: `client-${index}`,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      })
    })
    const wrapper = await mountPage(apps)

    await wrapper.get('[data-testid="connected-apps-disconnect-older"]')
      .trigger('click')
    await flushPromises()

    const sizes = mocks.fetch.mock.calls.map(([, options]) => {
      return (options as { body: { clientIds: string[] } }).body.clientIds
        .length
    })

    expect(sizes).toEqual([20, 2])
  })

  it('disconnects a single app after confirming', async () => {
    const wrapper = await mountPage([createApp()])

    await wrapper.get('[data-testid="connected-apps-revoke-client-1"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/connected-apps/client-1/revoke',
      { method: 'post' },
    )
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
