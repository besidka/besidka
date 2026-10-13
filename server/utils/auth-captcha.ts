import type { CloudflareTurnstileOptions } from 'better-auth/plugins'
import { createRequestLogger } from 'evlog'
import { getAllowedHosts, matchesHostnamePattern } from './auth-hosts'
import { shipWideEventToAxiom } from './evlog-drains'

const authCaptchaEndpoints = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
]

const authCaptchaExpectedAction = 'auth'

function stripPort(host: string): string {
  return host.split(':')[0] ?? host
}

function toTurnstileHostnames(hosts: string[]): string[] {
  const literalHostnames = hosts
    .filter(host => !host.includes('*'))
    .map(stripPort)
  const wildcardPatterns = hosts
    .map(stripPort)
    .filter(hostname => hostname.includes('*'))

  if (!wildcardPatterns.length) {
    return literalHostnames
  }

  const hostnames = [...literalHostnames, ...wildcardPatterns]

  Object.defineProperty(hostnames, 'includes', {
    value: (hostname: string): boolean => {
      return literalHostnames.includes(hostname)
        || wildcardPatterns.some((pattern) => {
          return matchesHostnamePattern(hostname, pattern)
        })
    },
  })

  return hostnames
}

export function getCaptchaOptions(
  config: ReturnType<typeof useRuntimeConfig>,
): CloudflareTurnstileOptions | null {
  const captchaEnabled = Boolean(config.turnstileSecretKey)
    && Boolean(config.public.turnstileSiteKey)

  if (!captchaEnabled) {
    if (config.turnstileEnforced === true) {
      logCaptchaMisconfigured(config)
    }

    return null
  }

  const enforced = config.turnstileEnforced

  return {
    provider: 'cloudflare-turnstile',
    secretKey: config.turnstileSecretKey,
    endpoints: authCaptchaEndpoints,
    expectedAction: enforced ? authCaptchaExpectedAction : undefined,
    allowedHostnames: enforced
      ? toTurnstileHostnames(getAllowedHosts(
        config.public.baseUrl,
        config.authAdditionalAllowedHosts,
      ))
      : undefined,
  }
}

function logCaptchaMisconfigured(
  config: ReturnType<typeof useRuntimeConfig>,
): void {
  const logger = createRequestLogger({
    method: 'BOOT',
    path: '/internal/auth-captcha',
  })

  logger.set({
    authCaptcha: {
      turnstileEnforced: config.turnstileEnforced,
      hasSecretKey: Boolean(config.turnstileSecretKey),
      hasSiteKey: Boolean(config.public.turnstileSiteKey),
    },
  })

  const wideEvent = logger.emit({
    message: 'captcha misconfigured: enforced=true but keys missing',
    status: 500,
  })

  if (wideEvent) {
    shipWideEventToAxiom(wideEvent)
  }
}
