import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import LinkedAccounts from '../../../../../app/components/Profile/Security/LinkedAccounts.vue'

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  linkSocial: vi.fn(),
  unlinkAccount: vi.fn(),
  signOut: vi.fn(),
  confirm: vi.fn(async () => ({ label: 'Disconnect', index: 0 })),
}))

mockNuxtImport('useConfirm', () => mocks.confirm)

const errorCodes = {
  FAILED_TO_UNLINK_LAST_ACCOUNT: {
    code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
    message: 'You can\'t unlink your last account',
  },
  SESSION_NOT_FRESH: {
    code: 'SESSION_NOT_FRESH',
    message: 'Session is not fresh',
  },
}

mockNuxtImport('useAuth', () => {
  return () => ({
    errorCodes,
    signOut: mocks.signOut,
    loggedIn: { value: true },
    fetchSession: vi.fn(),
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    client: {
      listAccounts: mocks.listAccounts,
      linkSocial: mocks.linkSocial,
      unlinkAccount: mocks.unlinkAccount,
    },
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function createAccount(overrides: {
  id: string
  providerId: string
  createdAt?: string
}) {
  return {
    id: overrides.id,
    providerId: overrides.providerId,
    accountId: `${overrides.providerId}-account`,
    userId: '1',
    createdAt: overrides.createdAt || '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scopes: [],
  }
}

describe('Profile/Security/LinkedAccounts', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset()
    mocks.linkSocial.mockReset()
    mocks.unlinkAccount.mockReset()
    mocks.signOut.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Disconnect', index: 0 })
  })

  it('maps the email_doesn\'t_match redirect error to a notice with a '
    + 'change-email link, and clears the query', async () => {
    mocks.listAccounts.mockResolvedValue({
      data: [createAccount({ id: '1', providerId: 'credential' })],
      error: null,
    })

    const wrapper = await mountSuspended(LinkedAccounts, {
      route: {
        path: '/profile/security',
        query: { error: 'email_doesn\'t_match' },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Emails don\'t match')

    const changeEmailLink = wrapper.find('a[to="/profile/email"]')

    expect(changeEmailLink.exists()).toBe(true)

    await flushPromises()

    expect(wrapper.vm.$route.query).toEqual({})
  })

  it('disables Disconnect when only one connected account remains',
    async () => {
      mocks.listAccounts.mockResolvedValue({
        data: [createAccount({ id: '1', providerId: 'credential' })],
        error: null,
      })

      const wrapper = await mountSuspended(LinkedAccounts)

      await flushPromises()

      const disconnectButtons = wrapper.findAll('[aria-label="Disconnect"]')

      expect(disconnectButtons).toHaveLength(1)
      expect(disconnectButtons[0]?.element.tagName).toBe('SPAN')
      expect(disconnectButtons[0]?.classes()).toContain('btn-disabled')
    })

  it('shows a recent-sign-in fallback with a working sign-out button when '
    + 'unlink rejects with SESSION_NOT_FRESH', async () => {
    mocks.listAccounts.mockResolvedValue({
      data: [
        createAccount({ id: '1', providerId: 'credential' }),
        createAccount({ id: '2', providerId: 'google' }),
      ],
      error: null,
    })
    mocks.unlinkAccount.mockResolvedValue({
      data: null,
      error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
    })

    const wrapper = await mountSuspended(LinkedAccounts)

    await flushPromises()

    const disconnectButton = wrapper.find('[aria-label="Disconnect"]')

    expect(disconnectButton.element.tagName).toBe('BUTTON')

    await disconnectButton.trigger('click')
    await flushPromises()

    expect(mocks.unlinkAccount).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Recent sign-in required')

    const signOutButton = wrapper.find('[aria-label="Sign out"]')

    expect(signOutButton.exists()).toBe(true)

    await signOutButton.trigger('click')
    await flushPromises()

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: '/signin' })
  })

  it('shows a success toast for ?linked=<provider> and clears the query',
    async () => {
      mocks.listAccounts.mockResolvedValue({
        data: [createAccount({ id: '1', providerId: 'credential' })],
        error: null,
      })

      const useSuccessMessage = vi.spyOn(messagesComposable, 'useSuccessMessage')

      const wrapper = await mountSuspended(LinkedAccounts, {
        route: {
          path: '/profile/security',
          query: { linked: 'github' },
        },
      })

      await flushPromises()

      expect(useSuccessMessage).toHaveBeenCalledWith('Connected GitHub')

      await flushPromises()

      expect(wrapper.vm.$route.query).toEqual({})
    })
})
