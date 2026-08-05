import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import SecurityPage from '../../../../app/pages/profile/security.vue'

const mocks = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn(async () => undefined),
  confirm: vi.fn(async () => ({ label: 'Delete account', index: 0 })),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: { value: true },
    fetchSession: vi.fn(),
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    requestAccountDeletion: mocks.requestAccountDeletion,
  })
})

mockNuxtImport('useConfirm', () => mocks.confirm)

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function stubs() {
  return {
    ProfileSecurityLinkedAccounts: {
      template: '<div data-testid="linked-accounts-stub" />',
    },
    ProfileSecuritySessions: {
      template: '<div data-testid="sessions-stub" />',
    },
    ProfileSecurityTwoFactor: {
      template: '<div data-testid="two-factor-stub" />',
    },
    ProfileSecurityPasskeys: {
      template: '<div data-testid="passkeys-stub" />',
    },
  }
}

describe('profile security page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.requestAccountDeletion.mockClear()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Delete account', index: 0 })
  })

  it('renders all five sections in order', async () => {
    const wrapper = await mountSuspended(SecurityPage, {
      global: { stubs: stubs() },
    })

    const headings = wrapper.findAll('h2').map(heading => heading.text())

    expect(headings).toEqual([
      'Sign-in methods',
      'Two-factor authentication',
      'Passkeys',
      'Active sessions',
      'Account removal',
    ])
    expect(wrapper.find('[data-testid="linked-accounts-stub"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="sessions-stub"]').exists()).toBe(true)
  })

  it('requests account deletion after confirmation', async () => {
    const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')

    const wrapper = await mountSuspended(SecurityPage, {
      global: { stubs: stubs() },
    })

    await wrapper.get('[data-testid="settings-delete-account"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1)
    expect(useInfoMessage).toHaveBeenCalledWith(
      'Check your email',
      'We sent a link to confirm deleting your account.',
    )
  })

  it('does not request deletion when the confirmation is declined',
    async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountSuspended(SecurityPage, {
        global: { stubs: stubs() },
      })

      await wrapper.get('[data-testid="settings-delete-account"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalled()
      expect(mocks.requestAccountDeletion).not.toHaveBeenCalled()
    })
})
