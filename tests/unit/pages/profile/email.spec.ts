import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as messagesComposable from '../../../../app/composables/messages'
import EmailPage from '../../../../app/pages/profile/email.vue'

const mocks = vi.hoisted(() => ({
  changeEmail: vi.fn(async () => ({ data: { status: true }, error: null })),
  sendVerificationEmail: vi.fn(async () => ({ data: null, error: null })),
}))

const state = vi.hoisted(() => ({
  user: {
    email: 'current@example.com',
    emailVerified: true,
  },
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    user: ref(state.user),
    session: ref(null),
    loggedIn: ref(true),
    lastLoginMethod: ref(null),
    fetchSession: vi.fn(),
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    client: {
      changeEmail: mocks.changeEmail,
      sendVerificationEmail: mocks.sendVerificationEmail,
      clearLastUsedLoginMethod: vi.fn(),
    },
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('profile email page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.changeEmail.mockClear()
    mocks.sendVerificationEmail.mockClear()
    state.user = {
      email: 'current@example.com',
      emailVerified: true,
    }
  })

  it('shows the identical confirmation message on every successful submit',
    async () => {
      const useInfoMessage = vi.spyOn(messagesComposable, 'useInfoMessage')
      const wrapper = await mountSuspended(EmailPage)
      const expectedMessage = [
        'Check your current email',
        'If that address is available, we\'ve sent a confirmation link to '
        + 'your current email address. Open it to continue.',
      ]

      await wrapper.find('input[type="email"]').setValue('new@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.changeEmail).toHaveBeenCalledWith({
        newEmail: 'new@example.com',
        callbackURL: '/profile/security',
      })
      expect(useInfoMessage).toHaveBeenLastCalledWith(...expectedMessage)

      await wrapper.find('input[type="email"]')
        .setValue('another-new@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(useInfoMessage).toHaveBeenLastCalledWith(...expectedMessage)
      expect(useInfoMessage).toHaveBeenCalledTimes(2)
    })

  it('rejects a resubmission of the current email before calling the server',
    async () => {
      const wrapper = await mountSuspended(EmailPage)

      await wrapper.find('input[type="email"]')
        .setValue('current@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      const emailInput = wrapper.find('input[type="email"]')

      expect(mocks.changeEmail).not.toHaveBeenCalled()
      expect(emailInput.attributes('user-invalid')).toBeDefined()
    })

  it(
    'shows a verify-first notice with a resend action instead of the form '
    + 'when the current email is not verified',
    async () => {
      state.user = {
        email: 'unverified@example.com',
        emailVerified: false,
      }

      const wrapper = await mountSuspended(EmailPage)

      expect(wrapper.find('[data-testid="email-submit"]').exists())
        .toBe(false)
      expect(wrapper.text()).toContain('Verify your current email first')
      expect(wrapper.text()).toContain('unverified@example.com')

      await wrapper.get('[data-testid="email-resend-verification"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'unverified@example.com',
        callbackURL: '/profile/email',
      })
    },
  )
})
