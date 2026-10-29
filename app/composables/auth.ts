// https://github.com/atinux/nuxthub-better-auth/blob/main/app/composables/auth.ts

import type {
  BetterAuthClientOptions,
  InferSessionFromClient,
} from 'better-auth/client'
import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import type { User } from '#shared/types/auth.d'
import { createAuthClient } from 'better-auth/vue'
import {
  lastLoginMethodClient,
  twoFactorClient,
} from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
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

const SIGNED_OAUTH_SIGNATURE_PARAM = 'sig'
const SIGNED_OAUTH_PARAMETER_NAMES_PARAM = 'ba_param'
const SIGNED_OAUTH_EXPIRY_PARAM = 'exp'
const SIGNED_OAUTH_INTERNAL_PARAMS = new Set([
  SIGNED_OAUTH_SIGNATURE_PARAM,
  SIGNED_OAUTH_PARAMETER_NAMES_PARAM,
  SIGNED_OAUTH_EXPIRY_PARAM,
  'ba_iat',
  'ba_pl',
])
const OAUTH_AUTHORIZE_PATH = '/api/auth/oauth2/authorize'

export type SignedOAuthQuery = Record<string, string | string[]>

function queryValues(value: LocationQuery[string] | undefined): string[] {
  if (value === undefined || value === null) {
    return []
  }

  const values = Array.isArray(value) ? value : [value]

  return values.filter((item): item is string => {
    return typeof item === 'string'
  })
}

function toQueryValue(values: string[]): string | string[] {
  return values.length === 1 ? values[0]! : values
}

/**
 * Picks the authorization-server signed OAuth query (`sig`, `ba_param` and
 * every parameter `ba_param` names) out of a route query, mirroring
 * `buildSignedOAuthQuery` in `@better-auth/oauth-provider`. Returns `null`
 * when the route does not carry a signed OAuth request.
 */
export function pickSignedOAuthQuery(
  query: LocationQuery,
): SignedOAuthQuery | null {
  const signatures = queryValues(query[SIGNED_OAUTH_SIGNATURE_PARAM])
  const signedNames = queryValues(query[SIGNED_OAUTH_PARAMETER_NAMES_PARAM])

  if (signatures.length !== 1 || !signedNames.length) {
    return null
  }

  const picked: SignedOAuthQuery = {
    [SIGNED_OAUTH_SIGNATURE_PARAM]: signatures[0]!,
    [SIGNED_OAUTH_PARAMETER_NAMES_PARAM]: toQueryValue(signedNames),
  }

  for (const name of new Set(signedNames)) {
    const values = queryValues(query[name])

    if (values.length) {
      picked[name] = toQueryValue(values)
    }
  }

  return picked
}

export function signedOAuthQueryToString(query: SignedOAuthQuery): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item)
    }
  }

  return params.toString()
}

export function appendSignedOAuthQueryToPath(
  path: string,
  query: SignedOAuthQuery | null,
): string {
  if (!query) {
    return path
  }

  const parsedUrl = new URL(path, 'http://localhost')

  for (const [key, value] of Object.entries(query)) {
    parsedUrl.searchParams.delete(key)

    for (const item of Array.isArray(value) ? value : [value]) {
      parsedUrl.searchParams.append(key, item)
    }
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
}

export function isSignedOAuthQueryExpired(
  query: SignedOAuthQuery,
  now: Date = new Date(),
): boolean {
  const expiresAtSeconds = Number(
    queryValues(query[SIGNED_OAUTH_EXPIRY_PARAM])[0],
  )

  if (!Number.isFinite(expiresAtSeconds)) {
    return true
  }

  return expiresAtSeconds * 1000 < now.getTime()
}

export function signedOAuthQueryRequiresSignIn(
  query: SignedOAuthQuery,
): boolean {
  const prompts = queryValues(query.prompt).join(' ').split(' ')

  return prompts.includes('login') || query.max_age !== undefined
}

/**
 * Builds the `/oauth2/authorize` URL that restarts an authorization request
 * from its signed query, without the signature fields the authorize
 * endpoint does not accept. Used when a signed-in user lands on the sign-in
 * page with a request that does not ask for a fresh sign-in.
 */
export function buildOAuthAuthorizeResumePath(
  query: SignedOAuthQuery,
): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (SIGNED_OAUTH_INTERNAL_PARAMS.has(key)) {
      continue
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item)
    }
  }

  return `${OAUTH_AUTHORIZE_PATH}?${params.toString()}`
}

export function readOAuthRedirectUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const { redirect, url } = data as { redirect?: unknown, url?: unknown }

  if (redirect !== true || typeof url !== 'string' || !url) {
    return null
  }

  return url
}

export function useAuth() {
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const client = createAuthClient({
    baseURL: useRequestURL().origin,
    fetchOptions: {
      headers,
    },
    plugins: [
      lastLoginMethodClient(),
      twoFactorClient(),
      passkeyClient(),
      oauthProviderClient(),
    ],
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
          twoFactorEnabled: false,
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
            preferenceStorage.removeItem('settings_reasoning_level')
            useLegalConsent().bindUser(null)

            if (!redirectTo) {
              return
            }

            reloadNuxtApp({
              path: typeof redirectTo === 'string' ? redirectTo : redirectTo?.path,
              force: true,
            })
          },
        },
      })
    },
    /**
     * Starts erasure by asking the server to email a confirmation link. The
     * account is destroyed only when that link is opened, so this resolves
     * with the account still intact and the session still valid.
     */
    async requestAccountDeletion() {
      const draftBackup = useChatDraftBackup()
      const preferenceStorage = usePreferenceStorage()
      const { error } = await client.deleteUser({
        callbackURL: '/',
      })

      if (error) {
        throw createError({
          statusCode: error.status,
          message: error.message || 'Failed to request account deletion.',
        })
      }

      // Deletion completes in a plain GET from the mail client, which lands on
      // '/' with no chance to run app code, so the device-local draft is
      // dropped here instead — same shared-device reasoning as signOut. It is
      // an unsent draft belonging to a user who just asked to be erased.
      draftBackup.clear()
      preferenceStorage.removeItem('chat_input')
      preferenceStorage.removeItem('settings_reasoning_level')
    },
    options,
    fetchSession,
    client,
    lastLoginMethod,
  }
}
