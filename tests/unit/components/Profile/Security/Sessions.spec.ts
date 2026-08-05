import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import Sessions from '../../../../../app/components/Profile/Security/Sessions.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  revokeOtherSessions: vi.fn(async () => ({
    data: { status: true },
    error: null,
  })),
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: { value: true },
    fetchSession: vi.fn(),
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    client: {
      revokeOtherSessions: mocks.revokeOtherSessions,
    },
  })
})

mockNuxtImport('useConfirm', () => mocks.confirm)

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function createSessionRow(overrides: {
  id: number
  current: boolean
  ipAddress?: string | null
  userAgent?: string | null
}) {
  return {
    id: overrides.id,
    current: overrides.current,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    expiresAt: '2026-08-10T00:00:00.000Z',
    ipAddress: overrides.ipAddress ?? '203.0.113.10',
    userAgent: overrides.userAgent
      ?? 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36',
  }
}

describe('Profile/Security/Sessions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.revokeOtherSessions.mockClear()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
  })

  it('pins the current session first and gives it no end-session action',
    async () => {
      mocks.fetch.mockImplementation((url: string) => {
        if (url === '/api/v1/profiles/sessions') {
          return Promise.resolve([
            createSessionRow({
              id: 2,
              current: false,
              userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
            }),
            createSessionRow({ id: 1, current: true }),
          ])
        }

        throw new Error(`Unexpected request: ${url}`)
      })

      const wrapper = await mountSuspended(Sessions)

      await flushPromises()

      expect(wrapper.text()).toContain('This device')

      const endSessionButtons = wrapper.findAll('[aria-label="End session"]')

      expect(endSessionButtons).toHaveLength(1)

      const rows = wrapper.findAll('li')

      expect(rows).toHaveLength(2)
      expect(rows[0]?.text()).toContain('This device')
      expect(rows[0]?.text()).not.toContain('End session')
      expect(rows[1]?.text()).toContain('End session')
    })

  it('ends a session through the id-based route, not anything '
    + 'token-based', async () => {
    const revokeCalls: { url: string, method?: string }[] = []

    mocks.fetch.mockImplementation((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/profiles/sessions') {
        return Promise.resolve([
          createSessionRow({ id: 1, current: true }),
          createSessionRow({ id: 2, current: false }),
        ])
      }

      revokeCalls.push({ url, method: options?.method })

      return Promise.resolve(null)
    })

    const wrapper = await mountSuspended(Sessions)

    await flushPromises()

    const endSessionButton = wrapper.find('[aria-label="End session"]')

    await endSessionButton.trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(revokeCalls).toHaveLength(1)
    expect(revokeCalls[0]?.url).toBe('/api/v1/profiles/sessions/2/revoke')
    expect(revokeCalls[0]?.method).toBe('post')
    expect(revokeCalls[0]?.url).not.toContain('token')
  })

  it('wires "sign out of all other sessions" to revokeOtherSessions and '
    + 'refreshes the list', async () => {
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/sessions') {
        return Promise.resolve([
          createSessionRow({ id: 1, current: true }),
          createSessionRow({ id: 2, current: false }),
        ])
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = await mountSuspended(Sessions)

    await flushPromises()

    const fetchCallsBeforeRevoke = mocks.fetch.mock.calls.length

    const revokeAllButton = wrapper.find(
      '[aria-label="Sign out of all other sessions"]',
    )

    expect(revokeAllButton.exists()).toBe(true)

    await revokeAllButton.trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.revokeOtherSessions).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.length).toBeGreaterThan(
      fetchCallsBeforeRevoke,
    )
  })

  it('shows a failure message and does not refresh the list when '
    + 'revokeOtherSessions resolves with an error', async () => {
    mocks.revokeOtherSessions.mockResolvedValueOnce({
      data: null,
      error: { message: 'Too many requests' },
    } as any)
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/sessions') {
        return Promise.resolve([
          createSessionRow({ id: 1, current: true }),
          createSessionRow({ id: 2, current: false }),
        ])
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const useSuccessMessage = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(Sessions)

    await flushPromises()

    const fetchCallsBeforeRevoke = mocks.fetch.mock.calls.length

    const revokeAllButton = wrapper.find(
      '[aria-label="Sign out of all other sessions"]',
    )

    await revokeAllButton.trigger('click')
    await flushPromises()

    expect(mocks.revokeOtherSessions).toHaveBeenCalledTimes(1)
    expect(useErrorMessage).toHaveBeenCalledWith('Too many requests')
    expect(useSuccessMessage).not.toHaveBeenCalled()
    expect(mocks.fetch.mock.calls.length).toBe(fetchCallsBeforeRevoke)
  })
})
