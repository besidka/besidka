import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionsEditor from '../../../../../app/components/Profile/ConnectedApps/PermissionsEditor.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

const APP = {
  clientId: 'client-1',
  name: 'Claude',
  scopes: ['chats:read', 'chats:write', 'data:delete'],
  canEditScopes: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null,
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('connected apps permissions editor', () => {
  beforeEach(() => {
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Remove all' })
    mocks.fetch.mockReset().mockResolvedValue(undefined)
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('shows only the granted resource scopes, all ticked, with the hint',
    async () => {
      const wrapper = await mountSuspended(PermissionsEditor, {
        props: { app: APP },
      })

      for (const scope of APP.scopes) {
        const input = wrapper.get(`[data-testid="oauth-scope-${scope}"]`)

        expect((input.element as HTMLInputElement).checked).toBe(true)
      }

      expect(wrapper.find('[data-testid="oauth-scope-memory:read"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="oauth-write-warning"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="connected-apps-add-hint"]').text())
        .toBe('To add permissions, reconnect this app from the app itself.')
    })

  it('keeps Save disabled until a permission is unticked', async () => {
    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })
    const save = wrapper.get('[data-testid="connected-apps-editor-save"]')

    expect(save.classes()).toContain('btn-disabled')

    await wrapper.get('[data-testid="oauth-scope-data:delete"]')
      .setValue(false)

    expect(wrapper.get('[data-testid="connected-apps-editor-save"]').classes())
      .not.toContain('btn-disabled')
  })

  it('saves the kept scopes with a PATCH and emits saved', async () => {
    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })

    await wrapper.get('[data-testid="oauth-scope-data:delete"]')
      .setValue(false)
    await wrapper.get('[data-testid="connected-apps-editor-save"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/connected-apps/client-1/scopes',
      { method: 'PATCH', body: { scopes: ['chats:read', 'chats:write'] } },
    )
    expect(mocks.success).toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('asks for confirmation before removing every permission', async () => {
    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })

    for (const scope of APP.scopes) {
      await wrapper.get(`[data-testid="oauth-scope-${scope}"]`)
        .setValue(false)
    }

    await wrapper.get('[data-testid="connected-apps-editor-save"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/connected-apps/client-1/scopes',
      { method: 'PATCH', body: { scopes: [] } },
    )
  })

  it('does not save when the removal is declined', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })

    for (const scope of APP.scopes) {
      await wrapper.get(`[data-testid="oauth-scope-${scope}"]`)
        .setValue(false)
    }

    await wrapper.get('[data-testid="connected-apps-editor-save"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows the server error and does not emit saved', async () => {
    mocks.fetch.mockRejectedValue({
      data: { message: 'Not allowed', why: 'Not granted to this app' },
      status: 400,
    })

    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })

    await wrapper.get('[data-testid="oauth-scope-data:delete"]')
      .setValue(false)
    await wrapper.get('[data-testid="connected-apps-editor-save"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.error).toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('emits cancel', async () => {
    const wrapper = await mountSuspended(PermissionsEditor, {
      props: { app: APP },
    })

    await wrapper.get('[data-testid="connected-apps-editor-cancel"]')
      .trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
