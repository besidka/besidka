interface CaptchaChallenge {
  execute: () => Promise<string>
  reset: () => void
}

const VERIFICATION_FAILED_TITLE = 'Verification failed'
const VERIFICATION_FAILED_DESCRIPTION
  = 'Please complete the human verification and try again.'
const VERIFICATION_UNAVAILABLE_TITLE = 'Verification unavailable'
const VERIFICATION_UNAVAILABLE_DESCRIPTION
  = 'Could not load the human verification. '
    + 'Disable content blockers for this site or reload the page.'

export function useCaptcha(
  getChallenge: () => CaptchaChallenge | null | undefined,
) {
  const isEnabled = Boolean(useRuntimeConfig().public.turnstileSiteKey)
  const loadFailed = useTurnstileLoadFailed()

  /**
   * Resolves the Turnstile token, `''` when the site key is not configured,
   * or `null` after surfacing a failure and resetting the widget so the
   * caller must not send the auth request. A configured site key with a
   * missing or unrendered widget is a failure, never a skipped challenge.
   */
  async function requestToken(): Promise<string | null> {
    if (!isEnabled) {
      return ''
    }

    const challenge = getChallenge()
    const token = await challenge?.execute() ?? ''

    if (token) {
      return token
    }

    if (loadFailed.value) {
      useErrorMessage(
        VERIFICATION_UNAVAILABLE_TITLE,
        VERIFICATION_UNAVAILABLE_DESCRIPTION,
      )
    } else {
      useErrorMessage(
        VERIFICATION_FAILED_TITLE,
        VERIFICATION_FAILED_DESCRIPTION,
      )
    }

    challenge?.reset()

    return null
  }

  return {
    requestToken,
  }
}
