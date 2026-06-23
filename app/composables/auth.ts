// https://github.com/atinux/nuxthub-better-auth/blob/main/app/composables/auth.ts

import type {
  BetterAuthClientOptions,
  InferSessionFromClient,
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import type { User } from '#shared/types/auth.d'
import { createAuthClient } from 'better-auth/vue'
import { lastLoginMethodClient } from 'better-auth/client/plugins'
import { defu } from 'defu'

interface RuntimeAuthConfig {
  redirectUserTo: RouteLocationRaw | string
  redirectGuestTo: RouteLocationRaw | string
}

// Client-only fetch sequencing: when a cache-bypassing recovery fetch overlaps
// a normal (possibly cookie-cached) fetch already in flight, only the most
// recently started fetch may write session state — so a stale truthy result
// cannot resurrect a session the bypass call just found dead.
let latestSessionFetchId = 0

export function useAuth() {
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const client = createAuthClient({
    baseURL: useRequestURL().origin,
    fetchOptions: {
      headers,
    },
    plugins: [lastLoginMethodClient()],
  })

  const options = defu(
    useRuntimeConfig().public.auth as Partial<RuntimeAuthConfig>,
    {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
  )

  const session = useState<InferSessionFromClient<BetterAuthClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server
    ? shallowRef(0)
    : useState('auth:sessionFetching', () => 0)

  const lastLoginMethod = useState<string | null>('auth:lastLoginMethod', () => null)

  if (import.meta.client) {
    const nuxtApp = useNuxtApp()
    const getLastUsedLoginMethod = typeof client.getLastUsedLoginMethod === 'function'
      ? client.getLastUsedLoginMethod.bind(client)
      : null

    const setLastLoginMethod = () => {
      lastLoginMethod.value = getLastUsedLoginMethod?.() ?? null
    }

    if (nuxtApp.isHydrating) {
      onNuxtReady(() => {
        setLastLoginMethod()
      })
    } else {
      setLastLoginMethod()
    }
  }

  async function fetchSession(options?: { disableCookieCache?: boolean }) {
    // A cache-bypassing refresh is the 401 recovery path and must always run,
    // never no-op behind an in-flight cached fetch, or a stale truthy session
    // would survive and skip the redirect to /signin. sessionFetching is an
    // in-flight counter (not a boolean) so the guard holds until every pending
    // fetch settles, even when a bypass call overlaps a normal one.
    if (sessionFetching.value > 0 && !options?.disableCookieCache) {
      return
    }

    sessionFetching.value++

    const fetchId = import.meta.client ? ++latestSessionFetchId : 0
    const query = options?.disableCookieCache
      ? { disableCookieCache: true }
      : undefined

    try {
      let data: Awaited<ReturnType<typeof client.getSession>>['data']

      if (import.meta.server) {
        data = await $fetch('/api/auth/get-session', {
          headers,
          query,
        })
      } else {
        const result = await client.getSession({
          fetchOptions: {
            headers,
          },
          query,
        })

        // A transport/server error (offline, flaky cell, captive portal, 5xx)
        // is NOT an authoritative "no session" — get-session returns 200/null
        // for an absent session. Preserve the last-known state so a network
        // blip (e.g. on PWA resume) cannot trigger a false logout.
        if (result.error) {
          return
        }

        data = result.data
      }

      // A newer fetch started after this one — let it be the source of truth.
      if (import.meta.client && fetchId !== latestSessionFetchId) {
        return data
      }

      session.value = data?.session || null
      user.value = data?.user
        ? defu(data.user, {
          image: null,
          role: null,
          banReason: null,
          banned: null,
          banExpires: null,
        })
        : null

      return data
    } catch {
      // Network/transport failure (thrown): transient, not a dead session —
      // leave the last-known session intact rather than forcing a logout.
      return
    } finally {
      sessionFetching.value--
    }
  }

  if (import.meta.client) {
    client.$store.listen('$sessionSignal', async (signal) => {
      if (!signal) return

      await fetchSession()
    })
  }

  return {
    session,
    user,
    loggedIn: computed<boolean>(() => !!session.value),
    signIn: client.signIn,
    signUp: client.signUp,
    requestPasswordReset: client.requestPasswordReset,
    resetPassword: client.resetPassword,
    errorCodes: client.$ERROR_CODES,
    async signOut({
      redirectTo,
    }: {
      redirectTo?: RouteLocationRaw
    } = {}) {
      const draftBackup = useChatDraftBackup()
      const preferenceStorage = usePreferenceStorage()

      await client.signOut({
        fetchOptions: {
          async onSuccess() {
            session.value = null
            user.value = null

            // Discard the unsent /chats/new draft on sign-out so it cannot
            // leak to the next user on a shared device — the backup lives
            // under the 'necessary' category (never auto-cleaned) and
            // chat_input persists whenever 'preferences' consent is granted.
            draftBackup.clear()
            preferenceStorage.removeItem('chat_input')

            if (!redirectTo) {
              return
            }

            await reloadNuxtApp({
              path: redirectTo.toString(),
              force: true,
            })
          },
        },
      })
    },
    options,
    fetchSession,
    client,
    lastLoginMethod,
  }
}
