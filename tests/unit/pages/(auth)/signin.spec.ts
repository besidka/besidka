import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import SigninPage from '../../../../app/pages/(auth)/signin.vue'

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(async () => ({
    data: { redirect: false, token: 'session-token', user: {} },
    error: null,
  })),
  navigateTo: vi.fn(async () => undefined),
}))

const errorCodes = {
  EMAIL_NOT_VERIFIED: {
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Email not verified',
  },
}

mockNuxtImport('useAuth', () => {
  return () => ({
    signIn: { email: mocks.signInEmail },
    errorCodes,
    lastLoginMethod: { value: null },
  })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)

function stubs() {
  return {
    AuthTurnstile: {
      template: '<div />',
      methods: {
        execute: () => Promise.resolve(''),
        reset: () => {},
      },
    },
  }
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function emailInput(wrapper: any) {
  return wrapper.find('input[placeholder="example@example.com"]')
}

function passwordInput(wrapper: any) {
  return wrapper.find('input[placeholder="Enter your password"]')
}

async function fillValidForm(wrapper: any) {
  await emailInput(wrapper).setValue('user@example.com')
  await passwordInput(wrapper).setValue('Password1!')
}

describe('signin page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.signInEmail.mockClear()
    mocks.navigateTo.mockClear()
    mocks.signInEmail.mockResolvedValue({
      data: { redirect: false, token: 'session-token', user: {} },
      error: null,
    })
  })

  it('shows the success message and does not redirect to /2fa on a '
    + 'normal sign-in', async () => {
    const useSuccessMessage = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        password: 'Password1!',
      }),
    )
    expect(useSuccessMessage).toHaveBeenCalledWith('Successfully signed in')
    expect(mocks.navigateTo).not.toHaveBeenCalledWith('/2fa')
  })

  it('navigates to /2fa and skips the success message when the '
    + 'response requires two-factor verification', async () => {
    mocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
      error: null,
    })

    const useSuccessMessage = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.navigateTo).toHaveBeenCalledWith('/2fa')
    expect(useSuccessMessage).not.toHaveBeenCalled()
  })

  it('shows an error message and does not redirect on invalid '
    + 'credentials', async () => {
    mocks.signInEmail.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(useErrorMessage).toHaveBeenCalledWith('Invalid email or password')
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })
})
