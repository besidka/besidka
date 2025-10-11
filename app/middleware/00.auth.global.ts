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

  if (import.meta.client && !loggedIn) {
    await fetchSession()
  }

  if (only === 'guest' && loggedIn.value) {
    if (to.path === redirectUserTo) {
      return
    }

    return navigateTo(redirectUserTo)
  }

  if (!loggedIn.value) {
    if (to.path === redirectGuestTo) {
      return
    }

    if (to.meta.auth?.only === 'user') {
      return navigateTo(redirectGuestTo)
    }
  }
})
