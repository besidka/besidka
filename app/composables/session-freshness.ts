export interface SessionFreshnessNotice {
  title: string
  description: string
}

export function useSessionFreshnessError() {
  const $auth = useAuth()

  function isSessionNotFresh(code?: string): boolean {
    return !!code && code === $auth.errorCodes.SESSION_NOT_FRESH?.code
  }

  function describeSessionFreshnessNotice(): SessionFreshnessNotice {
    return {
      title: 'Recent sign-in required',
      description: 'For your security, this action needs a recent '
        + 'sign-in. Please sign out and sign back in, then try again.',
    }
  }

  async function signOutForFreshSession() {
    await $auth.signOut({
      redirectTo: '/signin',
    })
  }

  return {
    isSessionNotFresh,
    describeSessionFreshnessNotice,
    signOutForFreshSession,
  }
}
