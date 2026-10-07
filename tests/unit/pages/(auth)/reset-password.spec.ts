import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import ResetPasswordPage from '../../../../app/pages/(auth)/reset-password.vue'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: '',
  requestPasswordReset: vi.fn(async (..._args: any[]) => ({
    data: { status: true },
    error: null as { message?: string } | null,
  })),
  navigateTo: vi.fn(async () => undefined),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    requestPasswordReset: mocks.requestPasswordReset,
  })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)

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
  await wrapper.find('input[placeholder="example@example.com"]')
    .setValue('user@example.com')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('reset-password page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.requestPasswordReset.mockClear()
    mocks.requestPasswordReset.mockResolvedValue({
      data: { status: true },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the captcha token header when verification succeeds',
    async () => {
      const wrapper = await mountSuspended(ResetPasswordPage, {
        global: { stubs: stubs({ isEnabled: true, token: 'captcha-token' }) },
      })

      await submitValidForm(wrapper)

      expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
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

    const wrapper = await mountSuspended(ResetPasswordPage, {
      global: { stubs: stubs({ isEnabled: true, token: '', reset }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
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
    const wrapper = await mountSuspended(ResetPasswordPage, {
      global: { stubs: stubs({ isEnabled: false, token: '' }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: expect.objectContaining({ headers: {} }),
      }),
    )
  })

  it('shows the returned error message and resets the widget when the '
    + 'server rejects the request', async () => {
    mocks.requestPasswordReset.mockResolvedValue({
      data: null as any,
      error: { message: 'Captcha verification failed' },
    })

    const reset = vi.fn()
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(ResetPasswordPage, {
      global: { stubs: stubs({ isEnabled: true, token: 'captcha-token', reset }) },
    })

    await submitValidForm(wrapper)

    expect(useErrorMessage).toHaveBeenCalledWith('Captcha verification failed')
    expect(reset).toHaveBeenCalled()
  })

  it('resets the widget after a successful request so the next submit gets a fresh token', async () => {
    const reset = vi.fn()

    const wrapper = await mountSuspended(ResetPasswordPage, {
      global: { stubs: stubs({ isEnabled: true, token: 'captcha-token', reset }) },
    })

    await submitValidForm(wrapper)

    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('ignores a second submit while the first is still pending', async () => {
    let resolveRequest: (value: any) => void = () => {}

    mocks.requestPasswordReset.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    })

    const wrapper = await mountSuspended(ResetPasswordPage, {
      global: { stubs: stubs() },
    })

    await submitValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(1)

    resolveRequest({ data: {}, error: null })
    await flushPromises()
  })
})
