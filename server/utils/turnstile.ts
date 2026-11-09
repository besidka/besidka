import { createRequestLogger } from 'evlog'
import { getAllowedHosts, matchesHostnamePattern } from '~~/server/utils/auth-hosts'
import { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'

export const TURNSTILE_SITEVERIFY_URL
  = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_TIMEOUT_MS = 5000
export const TURNSTILE_MISSING_RESPONSE_CODE = 'missing-input-response'

export interface TurnstileRuntimeConfig {
  turnstileSecretKey?: string
  turnstileEnforced?: boolean | string
  authAdditionalAllowedHosts?: string
  public: {
    baseUrl?: string
    turnstileSiteKey?: string
  }
}

export interface VerifyTurnstileOptions {
  expectedAction: string
  remoteIp?: string | null
  config?: TurnstileRuntimeConfig
  fetcher?: typeof fetch
}

export interface TurnstileVerification {
  ok: boolean
  skipped: boolean
  errorCodes: string[]
}

interface SiteverifyResponse {
  'success'?: boolean
  'error-codes'?: string[]
  'hostname'?: string
  'action'?: string
}

function isEnforced(config: TurnstileRuntimeConfig): boolean {
  return String(config.turnstileEnforced) === 'true'
}

export function isTurnstileConfigured(
  config: TurnstileRuntimeConfig,
): boolean {
  return Boolean(config.turnstileSecretKey)
    && Boolean(config.public.turnstileSiteKey)
}

function stripPort(host: string): string {
  return host.split(':')[0] ?? host
}

export function isAllowedTurnstileHostname(
  hostname: string | undefined,
  config: TurnstileRuntimeConfig,
): boolean {
  if (!hostname) {
    return false
  }

  const hosts = getAllowedHosts(
    config.public.baseUrl ?? '',
    config.authAdditionalAllowedHosts ?? '',
  )

  return hosts.some((host) => {
    return matchesHostnamePattern(hostname, stripPort(host))
  })
}

let misconfigurationLogged = false

function logTurnstileMisconfigured(config: TurnstileRuntimeConfig): void {
  if (misconfigurationLogged) {
    return
  }

  misconfigurationLogged = true

  const logger = createRequestLogger({
    method: 'BOOT',
    path: '/internal/turnstile',
  })

  logger.set({
    turnstile: {
      turnstileEnforced: config.turnstileEnforced,
      hasSecretKey: Boolean(config.turnstileSecretKey),
      hasSiteKey: Boolean(config.public.turnstileSiteKey),
    },
  })

  const wideEvent = logger.emit({
    message: 'turnstile misconfigured: enforced=true but keys missing',
    status: 500,
  })

  if (wideEvent) {
    shipWideEventToAxiom(wideEvent)
  }
}

function failed(...errorCodes: string[]): TurnstileVerification {
  return { ok: false, skipped: false, errorCodes }
}

/**
 * Checks a Turnstile token with Siteverify. Skipped (`ok`, `skipped`) when
 * Turnstile is not configured, as on Cloudflare Previews; a configuration
 * that says `turnstileEnforced` but lacks keys is logged once, like the
 * auth captcha. When enforced, the action must equal `expectedAction` and
 * the hostname must be one of the auth allowed hosts; the dummy test keys
 * used locally answer with neither, so those checks run only when enforced.
 * A network failure or timeout fails closed. The token is never logged.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  options: VerifyTurnstileOptions,
): Promise<TurnstileVerification> {
  const config = options.config
    ?? useRuntimeConfig() as unknown as TurnstileRuntimeConfig

  if (!isTurnstileConfigured(config)) {
    if (isEnforced(config)) {
      logTurnstileMisconfigured(config)
    }

    return { ok: true, skipped: true, errorCodes: [] }
  }

  if (!token) {
    return failed(TURNSTILE_MISSING_RESPONSE_CODE)
  }

  const form = new FormData()

  form.set('secret', config.turnstileSecretKey!)
  form.set('response', token)

  if (options.remoteIp) {
    form.set('remoteip', options.remoteIp)
  }

  let result: SiteverifyResponse

  try {
    const response = await (options.fetcher ?? fetch)(
      TURNSTILE_SITEVERIFY_URL,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      },
    )

    if (!response.ok) {
      return failed(`http-${response.status}`)
    }

    result = await response.json() as SiteverifyResponse
  } catch {
    return failed('network-error')
  }

  if (!result.success) {
    return failed(...(result['error-codes'] ?? ['invalid-input-response']))
  }

  if (!isEnforced(config)) {
    return { ok: true, skipped: false, errorCodes: [] }
  }

  if (result.action !== options.expectedAction) {
    return failed('action-mismatch')
  }

  if (!isAllowedTurnstileHostname(result.hostname, config)) {
    return failed('hostname-mismatch')
  }

  return { ok: true, skipped: false, errorCodes: [] }
}
