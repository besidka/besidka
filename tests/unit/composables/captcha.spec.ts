import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../app/composables/messages'
import { useCaptcha } from '../../../app/composables/captcha'
import { useTurnstileLoadFailed } from '../../../app/composables/turnstile'

const mocks = vi.hoisted(() => ({
  turnstileSiteKey: 'test-sitekey',
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { turnstileSiteKey: mocks.turnstileSiteKey },
  })
})

function createChallenge(token = '') {
  return {
    execute: vi.fn(async () => token),
    reset: vi.fn(),
  }
}

describe('useCaptcha', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.turnstileSiteKey = 'test-sitekey'
    useTurnstileLoadFailed().value = false
  })

  it('returns the token when verification succeeds', async () => {
    const challenge = createChallenge('captcha-token')
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => challenge)

    await expect(requestToken()).resolves.toBe('captcha-token')
    expect(challenge.reset).not.toHaveBeenCalled()
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('returns null, shows the error and resets the widget on an empty token', async () => {
    const challenge = createChallenge('')
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => challenge)

    await expect(requestToken()).resolves.toBeNull()
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Verification failed',
      'Please complete the human verification and try again.',
    )
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('treats a configured site key with a missing widget as a failure, not as disabled', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => null)

    await expect(requestToken()).resolves.toBeNull()
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Verification failed',
      'Please complete the human verification and try again.',
    )
  })

  it('shows the unavailable message when the Turnstile script failed to load', async () => {
    useTurnstileLoadFailed().value = true

    const challenge = createChallenge('')
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => challenge)

    await expect(requestToken()).resolves.toBeNull()
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Verification unavailable',
      'Could not load the human verification. '
      + 'Disable content blockers for this site or reload the page.',
    )
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('derives enabled from the site key config and skips the challenge when unset', async () => {
    mocks.turnstileSiteKey = ''

    const challenge = createChallenge('')
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => challenge)

    await expect(requestToken()).resolves.toBe('')
    expect(challenge.execute).not.toHaveBeenCalled()
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('returns an empty token without an error when disabled and the widget is not mounted', async () => {
    mocks.turnstileSiteKey = ''

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const { requestToken } = useCaptcha(() => null)

    await expect(requestToken()).resolves.toBe('')
    expect(useErrorMessage).not.toHaveBeenCalled()
  })
})
