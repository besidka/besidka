// Issue #235: an installed PWA can resume from suspension showing a stale
// "logged-in" UI while the server session has already expired or been evicted.
// Re-validate (bypassing the cookie cache) when the app regains focus so a dead
// session surfaces as a clean /signin redirect instead of a failed send.
const MIN_REVALIDATE_INTERVAL = 30_000

export default defineNuxtPlugin((nuxtApp) => {
  const { fetchSession, session, loggedIn } = useAuth()
  const route = useRoute()

  let lastRevalidatedAt = 0

  async function revalidate() {
    if (!loggedIn.value) {
      return
    }

    const now = Date.now()

    if (now - lastRevalidatedAt < MIN_REVALIDATE_INTERVAL) {
      return
    }

    lastRevalidatedAt = now

    await fetchSession({ disableCookieCache: true })

    if (session.value) {
      return
    }

    const auth = route.meta.auth

    if (auth && typeof auth === 'object' && auth.only === 'user') {
      await nuxtApp.runWithContext(() => navigateTo('/signin'))
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      revalidate()
    }
  })

  window.addEventListener('focus', () => {
    revalidate()
  })
})
