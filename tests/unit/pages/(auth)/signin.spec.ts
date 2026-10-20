import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import SigninPage from '../../../../app/pages/(auth)/signin.vue'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: '',
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
  signInSocial: vi.fn(async (..._args: any[]) => ({ data: {}, error: null })),
}))

const errorCodes = {
  EMAIL_NOT_VERIFIED: {
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Email not verified',
  },
}

mockNuxtImport('useAuth', () => {
  return () => ({
    signIn: {
      email: mocks.signInEmail,
      passkey: mocks.signInPasskey,
      social: mocks.signInSocial,
    },
    errorCodes,
    lastLoginMethod: { value: null },
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    fetchSession: mocks.fetchSession,
  })
})

const mockRoute = reactive<{
  query: Record<string, unknown>
  params: Record<string, unknown>
  path: string
}>({
  query: {},
  params: {},
  path: '/signin',
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('reloadNuxtApp', () => mocks.reloadNuxtApp)

mockNuxtImport('useRuntimeConfig', (original) => {
  return () => {
    const config = original()

    return {
      ...config,
      public: { ...config.public, turnstileSiteKey: mocks.turnstileSiteKey },
    }
  }
})

function stubs(options: {
  isEnabled?: boolean
  token?: string
  reset?: () => void
} = {}) {
  mocks.turnstileSiteKey = options.isEnabled ? 'test-sitekey' : ''

  return {
    AuthTurnstile: {
      template: '<div />',
      methods: {
        execute: () => Promise.resolve(options.token ?? ''),
        reset: options.reset ?? (() => {}),
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
    mocks.signInSocial.mockClear()
    mockRoute.query = {}
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

  it('sends the captcha token header when verification succeeds', async () => {
    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs({ isEnabled: true, token: 'captcha-token' }) },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: {
          headers: { 'x-captcha-response': 'captcha-token' },
        },
      }),
    )
  })

  it('does not send the request and shows a verification error when the '
    + 'enabled challenge yields no token', async () => {
    const reset = vi.fn()
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs({ isEnabled: true, token: '', reset }) },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signInEmail).not.toHaveBeenCalled()
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Verification failed',
      'Please complete the human verification and try again.',
    )
    expect(reset).toHaveBeenCalled()
    expect(wrapper.get('button[type="submit"]').attributes('disabled'))
      .toBeUndefined()
  })

  it('still sends the request without a token header when the challenge is '
    + 'disabled', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs({ isEnabled: false, token: '' }) },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fetchOptions: { headers: {} } }),
    )
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('ignores a second submit while the first is still pending', async () => {
    let resolveSignIn: (value: any) => void = () => {}

    mocks.signInEmail.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveSignIn = resolve
      })
    })

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs() },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signInEmail).toHaveBeenCalledTimes(1)

    resolveSignIn({ data: { redirect: false, user: {} }, error: null })
    await flushPromises()
  })

  it('restores the submit button, shows an error and resets the widget '
    + 'when the request throws', async () => {
    mocks.signInEmail.mockRejectedValueOnce(new Error('Network down'))

    const reset = vi.fn()
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SigninPage, {
      global: { stubs: stubs({ reset }) },
    })

    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(useErrorMessage).toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
    expect(wrapper.get('button[type="submit"]').attributes('disabled'))
      .toBeUndefined()
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
  describe('post-signin next path', () => {
    const SAFE_NEXT = '/profile/keys?provider=google'

    function findButton(wrapper: any, text: string) {
      return wrapper.findAll('button').find((button: any) => {
        return button.text().includes(text)
      })
    }

    it('uses the safe next value as the email sign-in callback', async () => {
      mockRoute.query = { next: SAFE_NEXT }

      const wrapper = await mountSuspended(SigninPage, {
        global: { stubs: stubs() },
      })

      await fillValidForm(wrapper)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.signInEmail).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: SAFE_NEXT }),
      )
    })

    it('keeps /chats/new as the email sign-in callback by default',
      async () => {
        const wrapper = await mountSuspended(SigninPage, {
          global: { stubs: stubs() },
        })

        await fillValidForm(wrapper)
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(mocks.signInEmail).toHaveBeenCalledWith(
          expect.objectContaining({ callbackURL: '/chats/new' }),
        )
      })

    it.each([
      ['//evil.com'],
      ['/\\evil.com'],
      ['https://evil.com'],
      ['/chats/123'],
    ])('falls back to /chats/new for the unsafe next value %j',
      async (unsafeNext) => {
        mockRoute.query = { next: unsafeNext }

        const wrapper = await mountSuspended(SigninPage, {
          global: { stubs: stubs() },
        })

        await fillValidForm(wrapper)
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(mocks.signInEmail).toHaveBeenCalledWith(
          expect.objectContaining({ callbackURL: '/chats/new' }),
        )
      })

    it('carries the safe next value into the two-factor redirect',
      async () => {
        mockRoute.query = { next: SAFE_NEXT }
        mocks.signInEmail.mockResolvedValue({
          data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
          error: null,
        })

        const wrapper = await mountSuspended(SigninPage, {
          global: { stubs: stubs() },
        })

        await fillValidForm(wrapper)
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        const [target] = mocks.navigateTo.mock.calls[0] as unknown as [string]
        const parsedTarget = new URL(target, 'http://localhost')

        expect(parsedTarget.pathname).toBe('/2fa')
        expect(parsedTarget.searchParams.get('next')).toBe(SAFE_NEXT)
      })

    it('reloads into the safe next value after a passkey sign-in',
      async () => {
        mockRoute.query = { next: SAFE_NEXT }

        const wrapper = await mountSuspended(SigninPage, {
          global: { stubs: stubs() },
        })

        await wrapper.get('[data-testid="signin-passkey"]').trigger('click')
        await flushPromises()

        expect(mocks.reloadNuxtApp)
          .toHaveBeenCalledWith({ path: SAFE_NEXT, force: true })
      })

    it('uses the safe next value as the social sign-in target, keeping '
      + 'the UTM parameters', async () => {
      mockRoute.query = { next: SAFE_NEXT, utm_source: 'reddit' }

      const wrapper = await mountSuspended(SigninPage, {
        global: { stubs: stubs() },
      })

      await findButton(wrapper, 'Sign in with Google').trigger('click')
      await flushPromises()

      const [payload] = mocks.signInSocial.mock.calls[0] as [
        { callbackURL: string },
      ]
      const target = new URL(payload.callbackURL, 'http://localhost')

      expect(target.pathname).toBe('/profile/keys')
      expect(target.searchParams.get('provider')).toBe('google')
      expect(target.searchParams.get('utm_source')).toBe('reddit')
    })

    it('carries the safe next value on the link to the sign-up page',
      async () => {
        mockRoute.query = { next: SAFE_NEXT }

        const wrapper = await mountSuspended(SigninPage, {
          global: {
            stubs: {
              ...stubs(),
              NuxtLink: {
                props: ['to'],
                template: '<a :href="to"><slot /></a>',
              },
            },
          },
        })

        const link = wrapper.findAll('a').find((anchor: any) => {
          return anchor.text() === 'Sign up'
        })
        const href = new URL(link!.attributes('href')!, 'http://localhost')

        expect(href.pathname).toBe('/signup')
        expect(href.searchParams.get('next')).toBe(SAFE_NEXT)
      })
  })
})
