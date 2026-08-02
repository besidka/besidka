// Cloudflare's test-key siteverify response has no `action` field and always
// reports hostname "example.com" — this gate must never collapse to "always
// enforce" (see docs/auth-security.md).
import { describe, expect, it } from 'vitest'
import { getCaptchaOptions } from '../../../server/utils/auth-captcha'

function createConfig(overrides: Partial<{
  turnstileSecretKey: string
  turnstileEnforced: boolean
  turnstileSiteKey: string
  baseUrl: string
}> = {}) {
  const {
    turnstileSecretKey = 'test-secret',
    turnstileEnforced = false,
    turnstileSiteKey = 'test-sitekey',
    baseUrl = 'https://www.besidka.com',
  } = overrides

  return {
    turnstileSecretKey,
    turnstileEnforced,
    public: {
      turnstileSiteKey,
      baseUrl,
    },
  } as any
}

describe('getCaptchaOptions', () => {
  it('returns null when the secret key is empty even if the sitekey is set', () => {
    const options = getCaptchaOptions(
      createConfig({ turnstileSecretKey: '' }),
    )

    expect(options).toBeNull()
  })

  it('returns null when the sitekey is empty even if the secret key is set', () => {
    const options = getCaptchaOptions(
      createConfig({ turnstileSiteKey: '' }),
    )

    expect(options).toBeNull()
  })

  it('returns null when both keys are empty', () => {
    const options = getCaptchaOptions(
      createConfig({ turnstileSecretKey: '', turnstileSiteKey: '' }),
    )

    expect(options).toBeNull()
  })

  it('passes the provider and secret key through when both keys are set', () => {
    const options = getCaptchaOptions(
      createConfig({ turnstileSecretKey: 'my-secret' }),
    )

    expect(options?.provider).toBe('cloudflare-turnstile')
    expect(options?.secretKey).toBe('my-secret')
  })

  it('lists exactly the three gated endpoints, explicitly', () => {
    const options = getCaptchaOptions(createConfig())

    expect(options?.endpoints).toEqual([
      '/sign-up/email',
      '/sign-in/email',
      '/request-password-reset',
    ])
  })

  it('leaves expectedAction and allowedHostnames undefined when not enforced', () => {
    const options = getCaptchaOptions(
      createConfig({ turnstileEnforced: false }),
    )

    expect(options?.expectedAction).toBeUndefined()
    expect(options?.allowedHostnames).toBeUndefined()
  })

  it('sets expectedAction and allowedHostnames when enforced', () => {
    const options = getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      baseUrl: 'https://www.besidka.com',
    }))

    expect(options?.expectedAction).toBe('auth')
    expect(options?.allowedHostnames).toEqual([
      'www.besidka.com',
      'besidka.com',
    ])
  })

  it('strips ports and wildcards getAllowedHosts would otherwise produce', () => {
    const options = getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      baseUrl: 'http://localhost:3000',
    }))

    expect(options?.allowedHostnames).toEqual(['localhost'])
    expect(options?.allowedHostnames?.some((host: string) => {
      return host.includes('*')
    })).toBe(false)
    expect(options?.allowedHostnames?.some((host: string) => {
      return host.includes(':')
    })).toBe(false)
  })
})
