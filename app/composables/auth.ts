// https://github.com/atinux/nuxthub-better-auth/blob/main/app/composables/auth.ts

import type {
  ClientOptions,
  InferSessionFromClient,
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { createAuthClient } from 'better-auth/vue'
import { defu } from 'defu'

interface RuntimeAuthConfig {
  redirectUserTo: RouteLocationRaw | string
  redirectGuestTo: RouteLocationRaw | string
}

export function useAuth() {
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const client = createAuthClient({
    baseURL: useRequestURL().origin,
    fetchOptions: {
      headers,
    },
  })

  const options = defu(
    useRuntimeConfig().public.auth as Partial<RuntimeAuthConfig>,
    {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
  )
  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server
    ? shallowRef(false)
    : useState('auth:sessionFetching', () => false)

  async function fetchSession() {
    if (sessionFetching.value) {
      return
    }

    sessionFetching.value = true

    try {
      let data: Awaited<ReturnType<typeof client.getSession>>['data']

      if (import.meta.server) {
        data = await $fetch('/api/auth/get-session', {
          headers,
        })
      } else {
        const result = await client.getSession({
          fetchOptions: {
            headers,
          },
        })

        data = result.data
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
      session.value = null
      user.value = null
    } finally {
      sessionFetching.value = false
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
    forgetPassword: client.forgetPassword,
    resetPassword: client.resetPassword,
    errorCodes: client.$ERROR_CODES,
    async signOut({ redirectTo }: { redirectTo?: RouteLocationRaw } = {}) {
      await client.signOut({
        fetchOptions: {
          onSuccess: async () => {
            session.value = null
            user.value = null
            if (redirectTo) {
              await reloadNuxtApp({
                path: redirectTo.toString(),
              })
            }
          },
        },
      })
    },
    options,
    fetchSession,
    client,
  }
}
