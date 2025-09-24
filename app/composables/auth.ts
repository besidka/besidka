import type {
  ClientOptions,
  InferSessionFromClient,
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { createAuthClient } from 'better-auth/vue'

export function useAuth() {
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const client = createAuthClient({
    baseURL: useRequestURL().origin,
    fetchOptions: {
      headers,
    },
  })

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }

    sessionFetching.value = true

    const { data } = await client.useSession(useFetch)

    session.value = data.value?.session || null

    // if (import.meta.server) {
    //   const { data } = await client.useSession(useFetch)

    //   session.value = data.value?.session || null
    // } else if (import.meta.client) {
    //   session.value = client.useSession()
    // }

    const userDefaults = {
      image: null,
      role: null,
      banReason: null,
      banned: null,
      banExpires: null,
    }
    // @ts-expect-error
    user.value = data.value?.user
      ? Object.assign({}, userDefaults, data.value.user)
      : null
    sessionFetching.value = false

    return data
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
    loggedIn: computed(() => !!session.value),
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
    fetchSession,
    client,
  }
}
