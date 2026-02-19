import { parseError } from 'evlog'

type SocialProvider = 'google' | 'github'

const embeddedBrowserPatterns: RegExp[] = [
  /fban/i,
  /fbav/i,
  /fb_iab/i,
  /instagram/i,
  /threads/i,
  /tiktok/i,
  /linkedinapp/i,
  /snapchat/i,
  /micromessenger/i,
  /line\//i,
  /; wv/i,
  /\bwebview\b/i,
]

const embeddedReferrerPatterns: RegExp[] = [
  /threads\.net/i,
  /instagram\.com/i,
  /facebook\.com/i,
  /tiktok\.com/i,
  /lnkd\.in/i,
]

const iosDevicePattern = /\b(iPhone|iPad|iPod)\b/i
const iosWebkitPattern = /\bAppleWebKit\b/i
const iosMobilePattern = /\bMobile\/\w+/i
const iosAllowedBrowserPattern = /\b(Safari|CriOS|FxiOS|EdgiOS|OPiOS)\b/i

export function isLikelyEmbeddedBrowser(userAgent?: string): boolean {
  const value = userAgent
    || (import.meta.client ? navigator.userAgent : '')

  if (!value) {
    return false
  }

  const hasKnownToken = embeddedBrowserPatterns.some((pattern) => {
    return pattern.test(value)
  })

  if (hasKnownToken) {
    return true
  }

  const referrer = import.meta.client ? document.referrer : ''
  const hasEmbeddedReferrer = embeddedReferrerPatterns.some((pattern) => {
    return pattern.test(referrer)
  })

  if (hasEmbeddedReferrer) {
    return true
  }

  const isIosWebView = iosDevicePattern.test(value)
    && iosWebkitPattern.test(value)
    && iosMobilePattern.test(value)
    && !iosAllowedBrowserPattern.test(value)

  if (isIosWebView) {
    return true
  }

  return false
}

export function getEmbeddedBrowserInstruction() {
  return [
    'Social sign-in is unavailable in in-app browsers.',
    'Open this page in your system browser and try again.',
    'Threads: tap menu (•••) and choose Open in browser.',
  ].join(' ')
}

export async function signInWithSocialOAuth(
  provider: SocialProvider,
  callbackURL = '/chats/new',
) {
  const { signIn } = useAuth()

  if (isLikelyEmbeddedBrowser()) {
    useErrorMessage(
      'Social sign-in is unavailable here',
      getEmbeddedBrowserInstruction(),
    )

    return
  }

  try {
    await signIn.social({
      provider,
      callbackURL,
      fetchOptions: {
        onSuccess() {
          useSuccessMessage(`Successfully signed in with ${provider}`)
        },
      },
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to start social sign-in',
      parsedException.why,
    )
  }
}
