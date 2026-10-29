import { defu } from 'defu'

type MiddlewareOptions = false | {
  only?: 'guest' | 'user'
  redirectUserTo?: string
  redirectGuestTo?: string
}

declare module '#app' {
  interface PageMeta {
    auth?: MiddlewareOptions
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    auth?: MiddlewareOptions
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.meta?.auth === false) {
    return
  }

  const { loggedIn, options, fetchSession } = useAuth()
  const { only, redirectUserTo, redirectGuestTo } = defu(to.meta?.auth, options)

  if (import.meta.client && !loggedIn.value) {
    await fetchSession()
  }

  const signedOAuthQuery = pickSignedOAuthQuery(to.query)

  if (signedOAuthQuery && only) {
    if (isSignedOAuthQueryExpired(signedOAuthQuery)) {
      if (import.meta.client) {
        useErrorMessage(
          'This connection request has expired',
          'Go back to the app you were connecting and start again.',
        )
      }

      return navigateTo(
        only === 'user' && !loggedIn.value ? redirectGuestTo : to.path,
      )
    }

    if (only === 'guest' && loggedIn.value) {
      if (signedOAuthQueryRequiresSignIn(signedOAuthQuery)) {
        return
      }

      return navigateTo(buildOAuthAuthorizeResumePath(signedOAuthQuery), {
        external: true,
      })
    }

    if (only === 'user' && !loggedIn.value) {
      return navigateTo({
        path: typeof redirectGuestTo === 'string' ? redirectGuestTo : '/signin',
        query: signedOAuthQuery,
      })
    }
  }

  if (only === 'guest' && loggedIn.value) {
    if (to.path === redirectUserTo) {
      return
    }

    return navigateTo(
      resolveSafeNextPath(to.query.next) ?? redirectUserTo,
    )
  }

  if (!loggedIn.value) {
    if (to.path === redirectGuestTo) {
      return
    }

    if (to.meta.auth?.only === 'user') {
      const next = resolveSafeNextPath(to.fullPath)

      if (
        !next
        || next === redirectUserTo
        || typeof redirectGuestTo !== 'string'
      ) {
        return navigateTo(redirectGuestTo)
      }

      return navigateTo({
        path: redirectGuestTo,
        query: { next },
      })
    }
  }
})
