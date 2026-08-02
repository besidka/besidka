import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as messagesComposable from '../../../../app/composables/messages'
import PasswordPage from '../../../../app/pages/profile/password.vue'

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  changePassword: vi.fn(async () => ({ data: { status: true }, error: null })),
}))

const errorCodes = {
  INVALID_PASSWORD: {
    code: 'INVALID_PASSWORD',
    message: 'Invalid password',
  },
}

function createAccount(providerId: string) {
  return {
    id: `${providerId}-1`,
    providerId,
    accountId: `${providerId}-account`,
    userId: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scopes: [],
  }
}

mockNuxtImport('useAuth', () => {
  return () => ({
    user: ref({ email: 'user@example.com', emailVerified: true }),
    session: ref(null),
    loggedIn: ref(true),
    lastLoginMethod: ref(null),
    fetchSession: vi.fn(),
    errorCodes,
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    client: {
      listAccounts: mocks.listAccounts,
      changePassword: mocks.changePassword,
      clearLastUsedLoginMethod: vi.fn(),
    },
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function checkboxInput(wrapper: any) {
  return wrapper.find('input[type="checkbox"]')
}

async function waitForForm(wrapper: any) {
  await vi.waitFor(() => {
    expect(checkboxInput(wrapper).exists()).toBe(true)
  })
}

async function waitForCard(wrapper: any) {
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('No password on this account')
  })
}

function currentPasswordInput(wrapper: any) {
  return wrapper.find('input[placeholder="Enter your current password"]')
}

function newPasswordInput(wrapper: any) {
  return wrapper.find('input[placeholder="Enter your new password"]')
}

function confirmPasswordInput(wrapper: any) {
  return wrapper.find('input[placeholder="Confirm your new password"]')
}

async function fillValidForm(wrapper: any) {
  await currentPasswordInput(wrapper).setValue('CurrentPass1!')
  await newPasswordInput(wrapper).setValue('NewPassword1!')
  await confirmPasswordInput(wrapper).setValue('NewPassword1!')
}

describe('profile password page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.listAccounts.mockReset()
    mocks.changePassword.mockReset()
    mocks.changePassword.mockResolvedValue({
      data: { status: true },
      error: null,
    })
    mocks.listAccounts.mockResolvedValue({
      data: [createAccount('credential')],
      error: null,
    })
  })

  it(
    'shows the password rules panel and defaults sign-out-on-other-devices '
    + 'on, forwarding it to changePassword',
    async () => {
      const wrapper = await mountSuspended(PasswordPage)

      await waitForForm(wrapper)

      expect((checkboxInput(wrapper).element as HTMLInputElement).checked)
        .toBe(true)

      await newPasswordInput(wrapper).trigger('focus')
      await flushPromises()

      expect(wrapper.text()).toContain('Time to crack')
      expect(wrapper.text()).toContain('at least 8 characters')

      await fillValidForm(wrapper)
      await wrapper.get('form').trigger('submit')

      await vi.waitFor(() => {
        expect(mocks.changePassword).toHaveBeenCalledWith({
          currentPassword: 'CurrentPass1!',
          newPassword: 'NewPassword1!',
          revokeOtherSessions: true,
        })
      })
    },
  )

  it('forwards revokeOtherSessions: false once the checkbox is unchecked',
    async () => {
      const wrapper = await mountSuspended(PasswordPage)

      await waitForForm(wrapper)

      await checkboxInput(wrapper).setValue(false)
      await fillValidForm(wrapper)
      await wrapper.get('form').trigger('submit')

      await vi.waitFor(() => {
        expect(mocks.changePassword).toHaveBeenCalledWith(
          expect.objectContaining({ revokeOtherSessions: false }),
        )
      })
    })

  it('maps a wrong current password to a plain-language message', async () => {
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountSuspended(PasswordPage)

    await waitForForm(wrapper)
    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(useErrorMessage).toHaveBeenCalledWith(
        'Your current password is incorrect',
      )
    })
  })

  it(
    'shows an explanatory message instead of a form for a Google/GitHub-only '
    + 'account',
    async () => {
      mocks.listAccounts.mockResolvedValue({
        data: [createAccount('google')],
        error: null,
      })

      const wrapper = await mountSuspended(PasswordPage)

      await waitForCard(wrapper)

      expect(wrapper.find('[data-testid="password-submit"]').exists())
        .toBe(false)
      expect(mocks.changePassword).not.toHaveBeenCalled()
    },
  )
})
