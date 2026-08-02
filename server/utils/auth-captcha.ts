import type { CloudflareTurnstileOptions } from 'better-auth/plugins'
import { getAllowedHosts } from './auth-hosts'

const authCaptchaEndpoints = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
]

const authCaptchaExpectedAction = 'auth'

function toTurnstileHostnames(hosts: string[]): string[] {
  return hosts
    .filter(host => !host.includes('*'))
    .map(host => host.split(':')[0] ?? host)
}

export function getCaptchaOptions(
  config: ReturnType<typeof useRuntimeConfig>,
): CloudflareTurnstileOptions | null {
  const captchaEnabled = Boolean(config.turnstileSecretKey)
    && Boolean(config.public.turnstileSiteKey)

  if (!captchaEnabled) {
    return null
  }

  const enforced = config.turnstileEnforced

  return {
    provider: 'cloudflare-turnstile',
    secretKey: config.turnstileSecretKey,
    endpoints: authCaptchaEndpoints,
    expectedAction: enforced ? authCaptchaExpectedAction : undefined,
    allowedHostnames: enforced
      ? toTurnstileHostnames(getAllowedHosts(config.public.baseUrl))
      : undefined,
  }
}
