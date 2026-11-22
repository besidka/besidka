import {
  getAllowedHosts,
  matchesHostnamePattern,
} from '~~/server/utils/auth-hosts'

const STATIC_OWN_HOST_PATTERNS: readonly string[] = [
  'besidka.com',
  'www.besidka.com',
  '*.besidka.com',
  '*.chernenko.workers.dev',
]

function stripPort(hostPattern: string): string {
  return hostPattern.replace(/:(\d+|\*)$/, '')
}

function hostnameOf(origin: unknown): string | null {
  if (typeof origin !== 'string' || origin === '') {
    return null
  }

  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

function readConfiguredPatterns(): string[] {
  try {
    const config = useRuntimeConfig()
    const allowedHosts = getAllowedHosts(
      config.public.baseUrl,
      config.authAdditionalAllowedHosts,
    )
    const artifactsHostname = hostnameOf(config.public.artifactsOrigin)

    return [
      ...allowedHosts.map(stripPort),
      ...(artifactsHostname ? [artifactsHostname] : []),
    ]
  } catch {
    return []
  }
}

/**
 * Whether a hostname is one of Besidka's own: the production and preview
 * hosts the app already trusts for sign-in (`NUXT_PUBLIC_BASE_URL` and
 * `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS`, through the same pattern rules), the
 * artifacts origin, and the account's own `workers.dev` and `besidka.com`
 * names. A connector or an import URL that points there would make the Worker
 * call itself or a sibling Worker with the user's chosen path, so every
 * outbound fetch refuses them. Reading the configuration is best effort: the
 * static names always apply.
 */
export function isOwnHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()

  return [...STATIC_OWN_HOST_PATTERNS, ...readConfiguredPatterns()].some(
    (pattern) => {
      return matchesHostnamePattern(normalized, pattern)
    },
  )
}
