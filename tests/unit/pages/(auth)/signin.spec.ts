import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import SigninPage from '../../../../app/pages/(auth)/signin.vue'

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(async () => ({
    data: { redirect: false, token: 'session-token', user: {} },
    error: null,
  })),
  signInPasskey: vi.fn(async () => ({
    data: { session: {}, user: {} },
    error: null,
  })),
  fetchSession: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  reloadNuxtApp: vi.fn(async () => undefined),
}))

const errorCodes = {
  EMAIL_NOT_VERIFIED: {
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Email not verified',
  },
}

mockNuxtImport('useAuth', () => {
  return () => ({
    signIn: { email: mocks.signInEmail, passkey: mocks.signInPasskey },
    errorCodes,
    lastLoginMethod: { value: null },
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    fetchSession: mocks.fetchSession,
  })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('reloadNuxtApp', () => mocks.reloadNuxtApp)

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
    mocks.signInPasskey.mockClear()
    mocks.fetchSession.mockClear()
    mocks.navigateTo.mockClear()
    mocks.reloadNuxtApp.mockClear()
    mocks.signInEmail.mockResolvedValue({
      data: { redirect: false, token: 'session-token', user: {} },
      error: null,
    })
    mocks.signInPasskey.mockResolvedValue({
      data: { session: {}, user: {} },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('sets the webauthn-enabled autocomplete value on the email field',
    async () => {
      const wrapper = await mountSuspended(SigninPage, {
        global: { stubs: stubs() },
      })

      expect(emailInput(wrapper).attributes('autocomplete'))
        .toBe('email webauthn')
    })

  it('attempts passkey autofill on mount when the browser reports '
    + 'conditional-mediation support', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: vi.fn(async () => true),
    })

    await mountSuspended(SigninPage, { global: { stubs: stubs() } })
    await flushPromises()

    expect(mocks.signInPasskey).toHaveBeenCalledWith({ autoFill: true })
    expect(mocks.reloadNuxtApp)
      .toHaveBeenCalledWith({ path: '/chats/new', force: true })
  })

  it('does not navigate when the autofill attempt resolves with an '
    + 'error', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: vi.fn(async () => true),
    })
    mocks.signInPasskey.mockResolvedValue({
      data: null,
      error: { message: 'No credential available' },
    })

    await mountSuspended(SigninPage, { global: { stubs: stubs() } })
    await flushPromises()

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
  })

  it('does not attempt passkey autofill when the browser has no '
    + 'WebAuthn support', async () => {
    await mountSuspended(SigninPage, { global: { stubs: stubs() } })
    await flushPromises()

    expect(mocks.signInPasskey).not.toHaveBeenCalled()
  })

  it('never surfaces an error when the autofill attempt rejects',
    async () => {
      vi.stubGlobal('PublicKeyCredential', {
        isConditionalMediationAvailable: vi.fn(async () => true),
      })
      mocks.signInPasskey.mockRejectedValueOnce(new Error('aborted'))

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

      await mountSuspended(SigninPage, { global: { stubs: stubs() } })
      await flushPromises()

      expect(useErrorMessage).not.toHaveBeenCalled()
    })

  it('renders a visible passkey sign-in button that signs in on click',
    async () => {
      const useSuccessMessage
        = vi.spyOn(messagesComposable, 'useSuccessMessage')

      const wrapper = await mountSuspended(SigninPage, {
        global: { stubs: stubs() },
      })

      await wrapper.get('[data-testid="signin-passkey"]').trigger('click')
      await flushPromises()

      expect(mocks.signInPasskey).toHaveBeenCalledWith({ autoFill: false })
      expect(useSuccessMessage).toHaveBeenCalledWith('Successfully signed in')
      expect(mocks.reloadNuxtApp)
        .toHaveBeenCalledWith({ path: '/chats/new', force: true })
    })

  it('does not show an error toast when the user cancels the passkey '
    + 'prompt from the visible button', async () => {
    mocks.signInPasskey.mockResolvedValue({
      data: null,
      error: {
        code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        message: 'The operation either timed out or was not allowed.',
      },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await wrapper.get('[data-testid="signin-passkey"]').trigger('click')
    await flushPromises()

    expect(useErrorMessage).not.toHaveBeenCalled()
    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
  })

  it('shows an error message for a genuine passkey sign-in failure',
    async () => {
      mocks.signInPasskey.mockResolvedValue({
        data: null,
        error: { message: 'No passkey found for this device' },
      })

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

      const wrapper = await mountSuspended(SigninPage, {
        global: { stubs: stubs() },
      })

      await wrapper.get('[data-testid="signin-passkey"]').trigger('click')
      await flushPromises()

      expect(useErrorMessage).toHaveBeenCalledWith(
        'No passkey found for this device',
      )
      expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    })

  it('ignores a late-resolving autofill success once the visible '
    + 'button has already completed a newer sign-in attempt', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: vi.fn(async () => true),
    })

    let resolveAutofillSignIn: (value: {
      data: { session: object, user: object } | null
      error: null
    }) => void = () => {}

    mocks.signInPasskey.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveAutofillSignIn = resolve
      })
    })

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await flushPromises()

    await wrapper.get('[data-testid="signin-passkey"]').trigger('click')
    await flushPromises()

    expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)

    resolveAutofillSignIn({ data: { session: {}, user: {} }, error: null })
    await flushPromises()

    expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)
  })
})
