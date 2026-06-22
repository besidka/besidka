import { useLogger } from 'evlog'

export function useUnauthorizedError() {
  throw createError({
    statusCode: 401,
    statusMessage: `You don't have access to this resource. Try to sign out and sign in again.`,
  })
}

// Matches the better-auth session-token cookie under any prefix:
// `better-auth.session_token`, `__Secure-...`, or `__Host-...`.
const SESSION_TOKEN_COOKIE
  = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/

export async function useUserSession() {
  const event = useEvent()
  const session = await useServerAuth().api.getSession({
    // @ts-ignore
    headers: getHeaders(event),
  })

  if (!session) {
    // Issue #235 diagnostic: distinguish a missing/expired session-token
    // cookie (client-side cookie loss) from a present cookie whose session
    // record is gone from KV+DB. Records a boolean only, never the value.
    const cookieHeader = getHeader(event, 'cookie') || ''

    useLogger(event).set({
      sessionCheck: {
        resolved: false,
        tokenCookiePresent: SESSION_TOKEN_COOKIE.test(cookieHeader),
      },
    })
  }

  return session
}
