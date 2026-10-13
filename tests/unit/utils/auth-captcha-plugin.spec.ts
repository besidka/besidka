import { afterEach, describe, expect, it, vi } from 'vitest'
import { captcha } from 'better-auth/plugins'
import { getCaptchaOptions } from '~~/server/utils/auth-captcha'

vi.mock('evlog', () => ({
  createRequestLogger: vi.fn(),
}))

vi.mock('~~/server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: vi.fn(),
}))

const previewConfig = {
  turnstileSecretKey: 'secret',
  turnstileEnforced: true,
  authAdditionalAllowedHosts: '*-besidka.chernenko.workers.dev',
  public: {
    turnstileSiteKey: 'sitekey',
    baseUrl: 'https://preview-besidka.chernenko.workers.dev',
  },
} as any

const productionConfig = {
  ...previewConfig,
  authAdditionalAllowedHosts: '',
  public: {
    turnstileSiteKey: 'sitekey',
    baseUrl: 'https://besidka.com',
  },
} as any

async function submitCaptcha(
  config: any,
  siteVerifyHostname: string,
): Promise<Response | undefined> {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    success: true,
    action: 'auth',
    hostname: siteVerifyHostname,
  }))

  const options = getCaptchaOptions(config)

  if (!options) {
    throw new Error('captcha options were not created')
  }

  const plugin = captcha(options)
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  const result: any = await plugin.onRequest?.(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'x-captcha-response': 'token' },
    }),
    { options: {}, logger } as any,
  )

  return result?.response
}

describe('captcha plugin with getCaptchaOptions hostnames', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a preview-host token matching the wildcard pattern', async () => {
    const response = await submitCaptcha(
      previewConfig,
      'pr-442-besidka.chernenko.workers.dev',
    )

    expect(response).toBeUndefined()
  })

  it('accepts the long-lived preview host token', async () => {
    const response = await submitCaptcha(
      previewConfig,
      'preview-besidka.chernenko.workers.dev',
    )

    expect(response).toBeUndefined()
  })

  it('rejects a token minted on a lookalike host', async () => {
    const response = await submitCaptcha(
      previewConfig,
      'evil-besidka.chernenko.workers.dev.attacker.com',
    )

    expect(response?.status).toBe(403)
  })

  it('rejects a token minted on an unrelated host', async () => {
    const response = await submitCaptcha(previewConfig, 'example.com')

    expect(response?.status).toBe(403)
  })

  it('keeps production exact-match: apex passes, preview host fails', async () => {
    const apexResponse = await submitCaptcha(productionConfig, 'besidka.com')
    const previewResponse = await submitCaptcha(
      productionConfig,
      'pr-442-besidka.chernenko.workers.dev',
    )

    expect(apexResponse).toBeUndefined()
    expect(previewResponse?.status).toBe(403)
  })
})
