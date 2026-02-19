import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthClient } from 'better-auth/vue'
import * as messagesComposable from '../../../app/composables/messages'
import {
  getEmbeddedBrowserInstruction,
  isLikelyEmbeddedBrowser,
  signInWithSocialOAuth,
} from '../../../app/composables/social-oauth'

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, 'referrer', {
    value: referrer,
    configurable: true,
  })
}

function createAuthClientMock(signInSocial: ReturnType<typeof vi.fn>) {
  return {
    signIn: {
      social: signInSocial,
      email: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    getSession: vi.fn(() => Promise.resolve({ data: null })),
    $store: {
      listen: vi.fn(),
    },
    $ERROR_CODES: {
      INVALID_EMAIL: 'INVALID_EMAIL',
    },
  }
}

describe('isLikelyEmbeddedBrowser', () => {
  beforeEach(() => {
    setReferrer('')
  })

  it('returns true for known in-app browser user agents', () => {
    const userAgents = [
      'Mozilla/5.0 Threads',
      'Mozilla/5.0 Instagram 340.0.0.0.92 Android',
      'Mozilla/5.0 FBAN/EMA FBAV/470.0.0.75.108',
      'Mozilla/5.0 TikTok 39.4.3 rv:390403',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) ; wv',
    ]

    for (const userAgent of userAgents) {
      expect(isLikelyEmbeddedBrowser(userAgent)).toBe(true)
    }
  })

  it('returns true for generic iOS webview user agents', () => {
    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
      + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

    expect(isLikelyEmbeddedBrowser(userAgent)).toBe(true)
  })

  it('returns true for known in-app referrers', () => {
    setReferrer('https://l.threads.net/?u=https%3A%2F%2Fexample.com')

    expect(isLikelyEmbeddedBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 '
      + 'Mobile/15E148 Safari/604.1',
    )).toBe(true)
  })

  it('returns false for regular browsers', () => {
    const userAgents = [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit'
      + '/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 '
      + 'Safari/604.1',
      'Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 '
      + 'Firefox/123.0',
    ]

    for (const userAgent of userAgents) {
      expect(isLikelyEmbeddedBrowser(userAgent)).toBe(false)
    }
  })
})

describe('signInWithSocialOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setReferrer('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts social sign-in in regular browsers', async () => {
    const signInSocial = vi.fn().mockResolvedValue({})

    vi.mocked(createAuthClient).mockImplementation(() => {
      return createAuthClientMock(signInSocial) as any
    })
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    )

    await signInWithSocialOAuth('google')

    expect(signInSocial).toHaveBeenCalledTimes(1)
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        callbackURL: '/chats/new',
        fetchOptions: expect.objectContaining({
          onSuccess: expect.any(Function),
        }),
      }),
    )
  })

  it('blocks social sign-in in embedded browsers', async () => {
    const signInSocial = vi.fn().mockResolvedValue({})
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    vi.mocked(createAuthClient).mockImplementation(() => {
      return createAuthClientMock(signInSocial) as any
    })
    setUserAgent('Mozilla/5.0 Threads')

    await signInWithSocialOAuth('google')

    expect(signInSocial).not.toHaveBeenCalled()
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Social sign-in is unavailable here',
      getEmbeddedBrowserInstruction(),
    )
  })
})
