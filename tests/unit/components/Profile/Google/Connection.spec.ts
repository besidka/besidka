import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import Connection from '../../../../../app/components/Profile/Google/Connection.vue'
import type { GoogleConnectionSummary } from '#shared/utils/google-connections'

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

type ConnectionPayload = { connection: GoogleConnectionSummary | null }

const connectionData = ref<ConnectionPayload | null>(null)
const fetchStatus = ref<string>('success')
const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} })

mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: connectionData,
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
    capabilities: ['identity', 'drive-picked'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

async function mountConnection() {
  const wrapper = await mountSuspended(Connection)

  await flushPromises()

  return wrapper
}

describe('Profile/Google/Connection', () => {
  beforeEach(() => {
    connectionData.value = { connection: null }
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
    connectionData.value = null
    fetchStatus.value = 'pending'

    const wrapper = await mountConnection()

    expect(wrapper.find('[data-testid="google-drive-skeleton"]').exists())
      .toBe(true)
  })

  it('offers to connect when nothing is connected', async () => {
    const wrapper = await mountConnection()

    expect(wrapper.text()).toContain('Google Drive')
    expect(wrapper.text()).toContain('Besidka can only see the files you pick.')
    expect(wrapper.find('[data-testid="google-drive-connect"]').exists())
      .toBe(true)
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
    connectionData.value = { connection: summary() }

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

  it('disconnects after a confirmation that names the deleted copies',
    async () => {
      connectionData.value = { connection: summary() }
      confirmMock.mockResolvedValue({ label: 'Disconnect', index: 0 })
      fetchMock.mockResolvedValue({
        disconnected: true,
        filesDeleted: 2,
        filesPending: false,
      })

      const wrapper = await mountConnection()

      await wrapper.get('[data-testid="google-drive-disconnect"]')
        .trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Disconnect Google Drive?',
        subtitle: expect.stringContaining(
          'Google Drive files copied into Besidka will be deleted',
        ),
      }))
      expect(confirmMock.mock.calls[0]![0].subtitle)
        .toContain('whenever Google access ends')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/google/connections/disconnect',
        { method: 'POST' },
      )
      expect(successMock).toHaveBeenCalledWith(
        'Google Drive disconnected',
        undefined,
      )
      expect(refreshMock).toHaveBeenCalled()
    })

  it('does nothing when the confirmation is declined', async () => {
    connectionData.value = { connection: summary() }
    confirmMock.mockResolvedValue(null)

    const wrapper = await mountConnection()

    await wrapper.get('[data-testid="google-drive-disconnect"]')
      .trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks to reconnect when Google access ended', async () => {
    connectionData.value = {
      connection: summary({ status: 'needs_reauth', capabilities: [] }),
    }

    const wrapper = await mountConnection()

    expect(wrapper.get('[data-testid="google-drive-status"]').text())
      .toBe('Reconnect needed')
    expect(wrapper.find('[data-testid="google-drive-reauth-alert"]').exists())
      .toBe(true)
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
