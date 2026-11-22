import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import OwnClient from '../../../../../app/components/Profile/Google/OwnClient.vue'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'

enableAutoUnmount(afterEach)

const {
  fetchMock,
  refreshMock,
  confirmMock,
  navigateToMock,
  successMock,
  errorMock,
  infoMock,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  confirmMock: vi.fn(),
  navigateToMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}))

const statusData = ref<GoogleConnectionStatusResponse | null>(null)
const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} })

mockNuxtImport('useGoogleConnection', () => {
  return () => ({
    data: statusData,
    status: ref('success'),
    refresh: refreshMock,
  })
})
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useConfirm', () => confirmMock)
mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useRoute', () => () => mockRoute)
mockNuxtImport('useSuccessMessage', () => successMock)
mockNuxtImport('useErrorMessage', () => errorMock)
mockNuxtImport('useInfoMessage', () => infoMock)

const REDIRECT_URI = 'https://besidka.com/api/v1/google/byo/callback'
const CLIENT_ID = 'owner-test-client-abcd.apps.googleusercontent.com'
const CLIENT_SECRET = 'test-owner-secret-value-0123456789'

function connection(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'byo',
    status: 'active',
    email: 'owner@example.test',
    capabilities: ['identity', 'drive-read'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function setByo(byo: Partial<GoogleByoConnectionStatus> | null) {
  statusData.value = {
    connection: null,
    canConnect: true,
    dedicatedClient: true,
    byo: byo
      ? {
        canManage: true,
        redirectUri: REDIRECT_URI,
        hasClient: false,
        connection: null,
        ...byo,
      }
      : null,
  }
}

async function mountOwnClient() {
  const wrapper = await mountSuspended(OwnClient, { attachTo: document.body })

  await flushPromises()

  return wrapper
}

describe('Profile/Google/OwnClient', () => {
  beforeEach(() => {
    setByo({})
    mockRoute.query = {}

    for (const mock of [
      fetchMock,
      refreshMock,
      confirmMock,
      navigateToMock,
      successMock,
      errorMock,
      infoMock,
    ]) {
      mock.mockReset()
    }
  })

  it('renders nothing without the own client in the status', async () => {
    setByo(null)

    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo"]').exists()).toBe(false)
  })

  it('says it is for the owner and shows the redirect URI to copy',
    async () => {
      const writeText = vi.fn(async () => {})

      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

      const wrapper = await mountOwnClient()
      const explainer = wrapper.get('[data-testid="google-byo-explainer"]')

      expect(explainer.text()).toContain('owner of this Besidka instance')
      expect(explainer.text()).toContain('verification status')
      expect(wrapper.get('[data-testid="google-byo-redirect-uri"]').text())
        .toBe(REDIRECT_URI)

      await wrapper.get('[data-testid="google-byo-copy-redirect"]')
        .trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledWith(REDIRECT_URI)
      expect(wrapper.get('[data-testid="google-byo-announcement"]').text())
        .toBe('Redirect URI copied.')
      vi.unstubAllGlobals()
    })

  it('offers no capabilities until a client is saved', async () => {
    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
      .exists()).toBe(false)
    expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
      .toBe(false)
  })

  it('saves the client, then clears both fields', async () => {
    fetchMock.mockResolvedValue({ saved: true, connectionEnded: false })

    const wrapper = await mountOwnClient()
    const secret = wrapper.get('[data-testid="google-byo-client-secret"]')

    expect((secret.element as HTMLInputElement).type).toBe('password')
    expect((secret.element as HTMLInputElement).value).toBe('')
    expect(secret.attributes('autocomplete')).toBe('new-password')

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue(CLIENT_ID)
    await secret.setValue(CLIENT_SECRET)
    await wrapper.get('[data-testid="google-byo-client-form"]')
      .trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      {
        method: 'POST',
        body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      },
    )
    expect(refreshMock).toHaveBeenCalled()
    expect((secret.element as HTMLInputElement).value).toBe('')
    expect(successMock).toHaveBeenCalledWith(
      'Google OAuth client saved',
      undefined,
    )
  })

  it('keeps Save disabled for an invalid client id', async () => {
    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue('not-a-client-id')
    await wrapper.get('[data-testid="google-byo-client-secret"]')
      .setValue(CLIENT_SECRET)

    expect(wrapper.get('[data-testid="google-byo-save"]')
      .attributes('disabled')).toBeDefined()
  })

  it('shows the server\'s refusal in an alert', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('Not saved'), {
      data: {
        message: 'This is not a Google OAuth client id',
        why: 'A client id ends with .apps.googleusercontent.com',
      },
    }))

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-client-id"]')
      .setValue(CLIENT_ID)
    await wrapper.get('[data-testid="google-byo-client-secret"]')
      .setValue(CLIENT_SECRET)
    await wrapper.get('[data-testid="google-byo-client-form"]')
      .trigger('submit')
    await flushPromises()

    const alert = wrapper.get('[data-testid="google-byo-save-error"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).not.toContain(CLIENT_SECRET)
  })

  it('says a client is saved and never shows it', async () => {
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-client-saved"]').text())
      .toContain('A client is saved')
    expect(wrapper.html()).not.toContain(CLIENT_SECRET)
    expect(wrapper.html()).not.toContain(CLIENT_ID)
  })

  it('connects with only the ticked capabilities', async () => {
    setByo({ hasClient: true })
    fetchMock.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })

    const wrapper = await mountOwnClient()
    const connect = wrapper.get('[data-testid="google-byo-connect"]')
    const ids = ['drive-read', 'gmail-read', 'gmail-compose', 'calendar']

    for (const id of ids) {
      const checkbox = wrapper.get(
        `[data-testid="google-byo-capability-${id}"]`,
      )

      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    }

    expect(connect.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="google-byo-capability-gmail-read"]')
      .setValue(true)
    await connect.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: ['gmail-read'],
        returnTo: '/profile/keys?tab=google',
      },
    })
    expect(navigateToMock).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      { external: true },
    )
  })

  it('says the tools arrive later and what gmail.compose allows', async () => {
    setByo({ hasClient: true })

    const wrapper = await mountOwnClient()
    const text = wrapper
      .get('[data-testid="google-byo-capabilities-form"]')
      .text()

    expect(text).toContain('requested now for tools that arrive later')
    expect(text).toContain('managing drafts and sending mail')
    expect(text).toContain('Besidka has no send tool')
  })

  it('shows the connected account and what Google granted', async () => {
    setByo({ hasClient: true, connection: connection() })

    const wrapper = await mountOwnClient()

    expect(wrapper.get('[data-testid="google-byo-status"]').text())
      .toBe('Connected')
    expect(wrapper.get('[data-testid="google-byo-email"]').text())
      .toBe('owner@example.test')
    expect(wrapper.get('[data-testid="google-byo-granted"]').text())
      .toContain('All your Google Drive files, read only')
  })

  it('lets a connected owner add a capability without disconnecting',
    async () => {
      setByo({ hasClient: true, connection: connection() })
      fetchMock.mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?y=2',
      })

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-capability-drive-read"]')
        .exists()).toBe(false)

      await wrapper.get('[data-testid="google-byo-capability-calendar"]')
        .setValue(true)

      const addAccess = wrapper.get('[data-testid="google-byo-connect"]')

      expect(addAccess.text()).toBe('Add access')

      await addAccess.trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/byo/start', {
        method: 'POST',
        body: {
          capabilities: ['drive-read', 'calendar'],
          returnTo: '/profile/keys?tab=google',
        },
      })
    })

  it('disconnects the own client behind a confirmation', async () => {
    setByo({ hasClient: true, connection: connection() })
    confirmMock.mockResolvedValue({ label: 'Disconnect', index: 0 })
    fetchMock.mockResolvedValue({
      disconnected: true,
      revoked: true,
      filesDeleted: 0,
      filesPending: false,
    })

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-disconnect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/google/connections/disconnect',
      { method: 'POST', body: { clientMode: 'byo' } },
    )
    expect(wrapper.get('[data-testid="google-byo-announcement"]').text())
      .toBe('Google disconnected.')
    expect(document.activeElement?.id).toBe('google-byo-heading')
  })

  it('does nothing when the disconnect is canceled', async () => {
    setByo({ hasClient: true, connection: connection() })
    confirmMock.mockResolvedValue(null)

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-disconnect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the client behind a confirmation', async () => {
    setByo({ hasClient: true })
    confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
    fetchMock.mockResolvedValue({
      deleted: true,
      connectionEnded: false,
      revoked: false,
    })

    const wrapper = await mountOwnClient()

    await wrapper.get('[data-testid="google-byo-delete"]').trigger('click')
    await flushPromises()

    expect(confirmMock.mock.calls[0]![0].subtitle)
      .toContain('A connection made with this client ends first')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      { method: 'DELETE' },
    )
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('keeps only Disconnect for a user who can no longer manage it',
    async () => {
      setByo({
        canManage: false,
        redirectUri: null,
        connection: connection(),
      })

      const wrapper = await mountOwnClient()

      expect(wrapper.find('[data-testid="google-byo-not-owner"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-client-form"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-redirect-uri"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-disconnect"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="google-byo-delete"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="google-byo-connect"]').exists())
        .toBe(false)
    })

  it('lets a former owner delete the client they left behind', async () => {
    setByo({ canManage: false, redirectUri: null, hasClient: true })
    confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
    fetchMock.mockResolvedValue({
      deleted: true,
      connectionEnded: false,
      revoked: false,
    })

    const wrapper = await mountOwnClient()

    expect(wrapper.find('[data-testid="google-byo-client-form"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="google-byo-capabilities-form"]')
      .exists()).toBe(false)

    await wrapper.get('[data-testid="google-byo-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google-oauth-client',
      { method: 'DELETE' },
    )
  })

  it('turns its own callback result into a toast and cleans the URL',
    async () => {
      mockRoute.query = { 'tab': 'google', 'google-byo': 'partial' }

      await mountOwnClient()

      expect(infoMock).toHaveBeenCalledWith(
        'Google granted only part of the access',
        'Only what Google granted is listed on this card.',
      )
      expect(refreshMock).toHaveBeenCalled()
      expect(navigateToMock).toHaveBeenCalledWith(
        { query: { tab: 'google' } },
        { replace: true },
      )
    })

  it('leaves the Drive card\'s callback result alone', async () => {
    mockRoute.query = { tab: 'google', google: 'connected' }

    await mountOwnClient()

    expect(successMock).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
