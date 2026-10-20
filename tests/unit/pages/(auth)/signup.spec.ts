import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import SignupPage from '../../../../app/pages/(auth)/signup.vue'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: '',
  signUpEmail: vi.fn(async (..._args: any[]) => ({
    data: { user: {} } as any,
    error: null as { message?: string } | null,
  })),
  signInSocial: vi.fn(async (..._args: any[]) => ({ data: {}, error: null })),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    signUp: { email: mocks.signUpEmail },
    signIn: { social: mocks.signInSocial },
  })
})

const mockRoute = reactive<{
  query: Record<string, unknown>
  params: Record<string, unknown>
  path: string
}>({
  query: {},
  params: {},
  path: '/signup',
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

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

async function submitValidForm(wrapper: any) {
  await wrapper.find('input[placeholder="John Doe"]').setValue('Test User')
  await wrapper.find('input[placeholder="example@example.com"]')
    .setValue('user@example.com')
  await wrapper.find('input[placeholder="Enter your password"]')
    .setValue('Password1!x')
  await wrapper.find('input[placeholder="Confirm your password"]')
    .setValue('Password1!x')
  await wrapper.find('input[type="checkbox"]').setValue(true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('signup page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.signUpEmail.mockClear()
    mocks.signInSocial.mockClear()
    mocks.signUpEmail.mockResolvedValue({ data: { user: {} }, error: null })
    mockRoute.query = {}
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the captcha token header when verification succeeds',
    async () => {
      const wrapper = await mountSuspended(SignupPage, {
        global: { stubs: stubs({ isEnabled: true, token: 'captcha-token' }) },
      })

      await submitValidForm(wrapper)

      expect(mocks.signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          fetchOptions: expect.objectContaining({
            headers: { 'x-captcha-response': 'captcha-token' },
          }),
        }),
      )
    })

  it('does not send the request and shows a verification error when the '
    + 'enabled challenge yields no token', async () => {
    const reset = vi.fn()
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SignupPage, {
      global: { stubs: stubs({ isEnabled: true, token: '', reset }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.signUpEmail).not.toHaveBeenCalled()
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
    const wrapper = await mountSuspended(SignupPage, {
      global: { stubs: stubs({ isEnabled: false, token: '' }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: expect.objectContaining({ headers: {} }),
      }),
    )
  })

  it('shows the returned error message and resets the widget when the '
    + 'server rejects the request', async () => {
    mocks.signUpEmail.mockResolvedValue({
      data: null as any,
      error: { message: 'Missing CAPTCHA response' },
    })

    const reset = vi.fn()
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(SignupPage, {
      global: { stubs: stubs({ isEnabled: false, token: '', reset }) },
    })

    await submitValidForm(wrapper)

    expect(useErrorMessage).toHaveBeenCalledWith('Missing CAPTCHA response')
    expect(reset).toHaveBeenCalled()
  })

  it('resets the widget after a successful request so the next submit gets a fresh token', async () => {
    const reset = vi.fn()

    const wrapper = await mountSuspended(SignupPage, {
      global: { stubs: stubs({ isEnabled: true, token: 'captcha-token', reset }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('ignores a second submit while the first is still pending', async () => {
    let resolveRequest: (value: any) => void = () => {}

    mocks.signUpEmail.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    })

    const wrapper = await mountSuspended(SignupPage, {
      global: { stubs: stubs() },
    })

    await submitValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.signUpEmail).toHaveBeenCalledTimes(1)

    resolveRequest({ data: {}, error: null })
    await flushPromises()
  })
  describe('post-signup next path', () => {
    function readCallbackUrl(): URL {
      const [payload] = mocks.signUpEmail.mock.calls[0] as [
        { callbackURL: string },
      ]

      return new URL(payload.callbackURL, 'http://localhost')
    }

    function findButton(wrapper: any, text: string) {
      return wrapper.findAll('button').find((button: any) => {
        return button.text().includes(text)
      })
    }

    it('sends the verification callback to /signin without a next value '
      + 'by default', async () => {
      const wrapper = await mountSuspended(SignupPage, {
        global: { stubs: stubs() },
      })

      await submitValidForm(wrapper)

      const callbackUrl = readCallbackUrl()

      expect(callbackUrl.pathname).toBe('/signin')
      expect(callbackUrl.searchParams.has('next')).toBe(false)
    })

    it('carries a safe next value through the verification callback '
      + 'next to the UTM parameters', async () => {
      mockRoute.query = {
        next: '/profile/keys?provider=google',
        utm_source: 'reddit',
        utm_campaign: 'launch',
      }

      const wrapper = await mountSuspended(SignupPage, {
        global: { stubs: stubs() },
      })

      await submitValidForm(wrapper)

      const callbackUrl = readCallbackUrl()

      expect(callbackUrl.pathname).toBe('/signin')
      expect(callbackUrl.searchParams.get('next'))
        .toBe('/profile/keys?provider=google')
      expect(callbackUrl.searchParams.get('utm_source')).toBe('reddit')
      expect(callbackUrl.searchParams.get('utm_campaign')).toBe('launch')
    })

    it('drops an unsafe next value from the verification callback',
      async () => {
        mockRoute.query = { next: '//evil.com' }

        const wrapper = await mountSuspended(SignupPage, {
          global: { stubs: stubs() },
        })

        await submitValidForm(wrapper)

        const callbackUrl = readCallbackUrl()

        expect(callbackUrl.pathname).toBe('/signin')
        expect(callbackUrl.searchParams.has('next')).toBe(false)
        expect(callbackUrl.href).not.toContain('evil.com')
      })

    it('uses the safe next value as the social sign-up target, keeping '
      + 'the UTM parameters', async () => {
      mockRoute.query = {
        next: '/profile/keys?provider=google',
        utm_source: 'reddit',
      }

      const wrapper = await mountSuspended(SignupPage, {
        global: { stubs: stubs() },
      })

      await findButton(wrapper, 'Sign up with Google').trigger('click')
      await flushPromises()

      const [payload] = mocks.signInSocial.mock.calls[0] as [
        { provider: string, callbackURL: string },
      ]
      const target = new URL(payload.callbackURL, 'http://localhost')

      expect(payload.provider).toBe('google')
      expect(target.pathname).toBe('/profile/keys')
      expect(target.searchParams.get('provider')).toBe('google')
      expect(target.searchParams.get('utm_source')).toBe('reddit')
    })

    it('keeps /chats/new as the social sign-up target by default',
      async () => {
        const wrapper = await mountSuspended(SignupPage, {
          global: { stubs: stubs() },
        })

        await findButton(wrapper, 'Sign up with GitHub').trigger('click')
        await flushPromises()

        expect(mocks.signInSocial).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'github',
            callbackURL: '/chats/new',
          }),
        )
      })

    it('does not use an unsafe next value as the social sign-up target',
      async () => {
        mockRoute.query = { next: 'https://evil.com' }

        const wrapper = await mountSuspended(SignupPage, {
          global: { stubs: stubs() },
        })

        await findButton(wrapper, 'Sign up with Google').trigger('click')
        await flushPromises()

        expect(mocks.signInSocial).toHaveBeenCalledWith(
          expect.objectContaining({ callbackURL: '/chats/new' }),
        )
      })

    it('carries the safe next value on the link to the sign-in page',
      async () => {
        mockRoute.query = { next: '/profile/keys?provider=google' }

        const wrapper = await mountSuspended(SignupPage, {
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
          return anchor.text() === 'Sign in'
        })
        const href = new URL(link!.attributes('href')!, 'http://localhost')

        expect(href.pathname).toBe('/signin')
        expect(href.searchParams.get('next'))
          .toBe('/profile/keys?provider=google')
      })
  })
})
