import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import Connection from '../../../../../app/components/Profile/Google/Connection.vue'
import type {
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
const fetchStatus = ref<string>('success')
const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} })

mockNuxtImport('useGoogleConnection', () => {
  return () => ({
    data: statusData,
    status: fetchStatus,
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

function summary(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'besidka',
    status: 'active',
    email: 'person@example.test',
    capabilities: ['drive-picked'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function setStatus(patch: Partial<GoogleConnectionStatusResponse> = {}) {
  statusData.value = {
    connection: null,
    canConnect: true,
    dedicatedClient: false,
    byo: null,
    ...patch,
  }
}

async function mountConnection() {
  const wrapper = await mountSuspended(Connection, { attachTo: document.body })

  await flushPromises()

  return wrapper
}

describe('Profile/Google/Connection', () => {
  beforeEach(() => {
    setStatus()
    fetchStatus.value = 'success'
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

  it('shows a skeleton while the status loads', async () => {
    statusData.value = null
    fetchStatus.value = 'pending'

    const wrapper = await mountConnection()

    expect(wrapper.find('[data-testid="google-drive-skeleton"]').exists())
      .toBe(true)
  })

  it('shows an error with a retry when the status cannot load', async () => {
    statusData.value = null
    fetchStatus.value = 'error'

    const wrapper = await mountConnection()

    expect(wrapper.find('[data-testid="google-drive-load-error"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="google-drive-connect"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="google-drive-retry"]').trigger('click')

    expect(refreshMock).toHaveBeenCalled()
  })

  it('explains what connecting does without promising a picker',
    async () => {
      const wrapper = await mountConnection()
      const text = wrapper.get('[data-testid="google-drive-explainer"]').text()

      expect(text).toContain('access only to the Google Drive files you pick')
      expect(text).toContain('copied into your Besidka files')
      expect(text).toContain('email address')
      expect(text).not.toMatch(/button/i)
      expect(wrapper.find('[data-testid="google-drive-connect"]').exists())
        .toBe(true)
    })

  it('offers no Connect button while connecting is off', async () => {
    setStatus({ canConnect: false })

    const wrapper = await mountConnection()

    expect(wrapper.find('[data-testid="google-drive-connect"]').exists())
      .toBe(false)
  })

  it('opens Google\'s consent page on connect', async () => {
    fetchMock.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })

    const wrapper = await mountConnection()

    await wrapper.get('[data-testid="google-drive-connect"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/google/oauth/start', {
      method: 'POST',
      body: { returnTo: '/profile/keys?tab=google' },
    })
    expect(navigateToMock).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      { external: true },
    )
  })

  it('shows an error when connecting fails', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('Too many Google requests'), {
        data: { message: 'Too many Google requests' },
      }),
    )

    const wrapper = await mountConnection()

    await wrapper.get('[data-testid="google-drive-connect"]').trigger('click')
    await flushPromises()

    expect(errorMock).toHaveBeenCalledWith(
      'Too many Google requests',
      undefined,
    )
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('shows the account and what Besidka can access', async () => {
    setStatus({ connection: summary() })

    const wrapper = await mountConnection()

    expect(wrapper.get('[data-testid="google-drive-status"]').text())
      .toBe('Connected')
    expect(wrapper.get('[data-testid="google-drive-email"]').text())
      .toBe('person@example.test')
    expect(wrapper.get('[data-testid="google-drive-capabilities"]').text())
      .toContain('Only the Google Drive files you pick')
    expect(wrapper.find('[data-testid="google-drive-reconnect"]').exists())
      .toBe(false)
  })

  it('styles Disconnect like the Delete button of an API key', async () => {
    setStatus({ connection: summary() })

    const wrapper = await mountConnection()
    const button = wrapper.get('[data-testid="google-drive-disconnect"]')

    expect(button.classes()).toEqual(
      expect.arrayContaining(['btn', 'btn-error', 'btn-outline']),
    )
    expect(button.classes()).not.toContain('btn-ghost')
    expect(button.text()).toBe('Disconnect')
  })

  it('keeps Disconnect for a connected user while connecting is off',
    async () => {
      setStatus({ connection: summary(), canConnect: false })

      const wrapper = await mountConnection()

      expect(wrapper.find('[data-testid="google-drive-disconnect"]').exists())
        .toBe(true)
    })

  it('disconnects, announces it and moves focus', async () => {
    setStatus({ connection: summary(), dedicatedClient: true })
    confirmMock.mockResolvedValue({ label: 'Disconnect', index: 0 })
    fetchMock.mockResolvedValue({
      disconnected: true,
      revoked: true,
      filesDeleted: 2,
      filesPending: false,
    })
    refreshMock.mockImplementation(async () => {
      setStatus({ dedicatedClient: true })
    })

    const wrapper = await mountConnection()

    await wrapper.get('[data-testid="google-drive-disconnect"]')
      .trigger('click')
    await flushPromises()

    const subtitle = confirmMock.mock.calls[0]![0].subtitle as string

    expect(subtitle).toContain(
      'Google Drive files copied into Besidka will be deleted',
    )
    expect(subtitle).toContain('whenever Google access ends')
    expect(subtitle).not.toContain('Sign in with Google')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/google/connections/disconnect',
      { method: 'POST' },
    )
    expect(successMock).toHaveBeenCalledWith(
      'Google Drive disconnected',
      'The copied Google Drive files were deleted.',
    )
    expect(errorMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="google-drive-announcement"]').text())
      .toBe('Google Drive disconnected.')
    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('google-drive-connect')
  })

  it('warns about the sign-in consent on the shared client', async () => {
    setStatus({ connection: summary(), dedicatedClient: false })
    confirmMock.mockResolvedValue(null)

    const wrapper = await mountConnection()

    await wrapper.get('[data-testid="google-drive-disconnect"]')
      .trigger('click')
    await flushPromises()

    expect(confirmMock.mock.calls[0]![0].subtitle).toContain(
      'Google will ask for your consent again the next time you use Sign in '
      + 'with Google.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says when Google did not confirm the revoke and cleanup is pending',
    async () => {
      setStatus({ connection: summary() })
      confirmMock.mockResolvedValue({ label: 'Disconnect', index: 0 })
      fetchMock.mockResolvedValue({
        disconnected: true,
        revoked: false,
        filesDeleted: 0,
        filesPending: true,
      })

      const wrapper = await mountConnection()

      await wrapper.get('[data-testid="google-drive-disconnect"]')
        .trigger('click')
      await flushPromises()

      expect(successMock.mock.calls[0]![1]).toContain('finishes shortly')
      expect(successMock.mock.calls[0]![1]).not.toContain('hour')
      expect(errorMock.mock.calls[0]![1])
        .toContain('https://myaccount.google.com/connections')
    })

  it('asks to reconnect when Google access ended', async () => {
    setStatus({
      connection: summary({ status: 'needs_reauth', capabilities: [] }),
    })

    const wrapper = await mountConnection()
    const alert = wrapper.get('[data-testid="google-drive-reauth-alert"]')

    expect(wrapper.get('[data-testid="google-drive-status"]').text())
      .toBe('Reconnect needed')
    expect(alert.text()).not.toContain('were deleted')
    expect(wrapper.find('[data-testid="google-drive-reconnect"]').exists())
      .toBe(true)
  })

  it.each([
    ['connected', successMock, 'Google Drive connected'],
    ['denied', infoMock, 'Google Drive was not connected'],
    ['missing_scope', errorMock, 'Google Drive was not connected'],
    ['expired', errorMock, 'The connection timed out'],
    ['error', errorMock, 'Google Drive could not be connected'],
  ] as const)('shows the %s callback result and strips it', async (
    result,
    messageMock,
    title,
  ) => {
    mockRoute.query = { tab: 'google', google: result }

    await mountConnection()

    expect(messageMock.mock.calls[0]![0]).toBe(title)
    expect(navigateToMock).toHaveBeenCalledWith(
      { query: { tab: 'google' } },
      { replace: true },
    )
  })

  it('ignores an unknown callback result', async () => {
    mockRoute.query = { google: 'surprise' }

    await mountConnection()

    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
