// Cloudflare's test-key siteverify response has no `action` field and always
// reports hostname "example.com" — this gate must never collapse to "always
// enforce" (see docs/auth-security.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCaptchaOptions } from '../../../server/utils/auth-captcha'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  loggerEmit: vi.fn(() => ({ message: 'captcha misconfigured' })),
  createRequestLogger: vi.fn(),
  shipWideEventToAxiom: vi.fn(async () => undefined),
}))

vi.mock('evlog', () => ({
  createRequestLogger: mocks.createRequestLogger,
}))

vi.mock('../../../server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: mocks.shipWideEventToAxiom,
}))

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
    baseUrl = 'https://besidka.com',
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
  beforeEach(() => {
    mocks.loggerSet.mockClear()
    mocks.loggerEmit.mockClear()
    mocks.createRequestLogger.mockClear()
    mocks.shipWideEventToAxiom.mockClear()
    mocks.createRequestLogger.mockReturnValue({
      set: mocks.loggerSet,
      emit: mocks.loggerEmit,
    })
  })

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
      baseUrl: 'https://besidka.com',
    }))

    expect(options?.expectedAction).toBe('auth')
    expect(options?.allowedHostnames).toEqual([
      'besidka.com',
      'www.besidka.com',
    ])
  })

  it(
    'sets the same allowedHostnames pair when the configured base URL '
    + 'is still the legacy www host',
    () => {
      const options = getCaptchaOptions(createConfig({
        turnstileEnforced: true,
        baseUrl: 'https://www.besidka.com',
      }))

      expect(options?.expectedAction).toBe('auth')
      expect(options?.allowedHostnames).toEqual([
        'www.besidka.com',
        'besidka.com',
      ])
    },
  )

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

describe('getCaptchaOptions captcha misconfiguration logging', () => {
  beforeEach(() => {
    mocks.loggerSet.mockClear()
    mocks.loggerEmit.mockClear()
    mocks.createRequestLogger.mockClear()
    mocks.shipWideEventToAxiom.mockClear()
    mocks.createRequestLogger.mockReturnValue({
      set: mocks.loggerSet,
      emit: mocks.loggerEmit,
    })
  })

  it('fires when enforced is true and the secret key is empty', () => {
    getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      turnstileSecretKey: '',
    }))

    expect(mocks.createRequestLogger).toHaveBeenCalledTimes(1)
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      authCaptcha: expect.objectContaining({
        turnstileEnforced: true,
        hasSecretKey: false,
        hasSiteKey: true,
      }),
    }))
    expect(mocks.loggerEmit).toHaveBeenCalledWith(expect.objectContaining({
      message: 'captcha misconfigured: enforced=true but keys missing',
    }))
    expect(mocks.shipWideEventToAxiom).toHaveBeenCalledTimes(1)
  })

  it('fires when enforced is true and the sitekey is empty', () => {
    getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      turnstileSiteKey: '',
    }))

    expect(mocks.createRequestLogger).toHaveBeenCalledTimes(1)
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      authCaptcha: expect.objectContaining({
        turnstileEnforced: true,
        hasSecretKey: true,
        hasSiteKey: false,
      }),
    }))
  })

  it('fires when enforced is true and both keys are empty', () => {
    getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      turnstileSecretKey: '',
      turnstileSiteKey: '',
    }))

    expect(mocks.createRequestLogger).toHaveBeenCalledTimes(1)
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      authCaptcha: expect.objectContaining({
        turnstileEnforced: true,
        hasSecretKey: false,
        hasSiteKey: false,
      }),
    }))
  })

  it('does not fire when enforced is false, even with missing keys', () => {
    getCaptchaOptions(createConfig({
      turnstileEnforced: false,
      turnstileSecretKey: '',
      turnstileSiteKey: '',
    }))

    expect(mocks.createRequestLogger).not.toHaveBeenCalled()
    expect(mocks.shipWideEventToAxiom).not.toHaveBeenCalled()
  })

  it('does not fire when enforced is true but both keys are present', () => {
    getCaptchaOptions(createConfig({
      turnstileEnforced: true,
      turnstileSecretKey: 'my-secret',
      turnstileSiteKey: 'my-sitekey',
    }))

    expect(mocks.createRequestLogger).not.toHaveBeenCalled()
    expect(mocks.shipWideEventToAxiom).not.toHaveBeenCalled()
  })
})
