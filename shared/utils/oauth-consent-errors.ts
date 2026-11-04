export const OAUTH_CONSENT_ERROR_PARAM = 'consent_error'

export const OAUTH_CONSENT_ERRORS = {
  expired: {
    title: 'This connection request has expired',
    description: 'Go back to the app you were connecting and start again.',
  },
  account_changed: {
    title: 'Your account changed in another tab',
    description: 'Check which account is shown below, then decide again.',
  },
  nothing_selected: {
    title: 'Nothing was selected',
    description: 'Choose at least one thing to share to approve, or deny the '
      + 'request.',
  },
  rate_limited: {
    title: 'Too many attempts',
    description: 'Wait a minute, then try again.',
  },
  failed: {
    title: 'Failed to save your decision',
    description: 'Try again. If it keeps failing, go back to the app and '
      + 'start the connection again.',
  },
} as const

export type OAuthConsentErrorCode = keyof typeof OAUTH_CONSENT_ERRORS

export function isOAuthConsentErrorCode(
  value: unknown,
): value is OAuthConsentErrorCode {
  return typeof value === 'string' && Object.hasOwn(OAUTH_CONSENT_ERRORS, value)
}
