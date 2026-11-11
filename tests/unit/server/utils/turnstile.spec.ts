import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ship: vi.fn(),
}))

vi.mock('~~/server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: mocks.ship,
}))

const {
  TURNSTILE_SITEVERIFY_URL,
  isAllowedTurnstileHostname,
  verifyTurnstileToken,
} = await import('~~/server/utils/turnstile')

const TOKEN = 'turnstile-response-token'

function config(overrides: {
  secret?: string
  siteKey?: string
  enforced?: boolean
  baseUrl?: string
  additionalHosts?: string
} = {}) {
  return {
    turnstileSecretKey: overrides.secret ?? 'secret-key',
    turnstileEnforced: overrides.enforced ?? false,
    authAdditionalAllowedHosts: overrides.additionalHosts ?? '',
    public: {
      baseUrl: overrides.baseUrl ?? 'https://besidka.com',
      turnstileSiteKey: overrides.siteKey ?? 'site-key',
    },
  }
}

function respond(body: unknown, status = 200) {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), { status })
  })
}

describe('verifyTurnstileToken', () => {
  it('skips the check when Turnstile is not configured', async () => {
    const fetcher = respond({ success: false })

    await expect(verifyTurnstileToken(undefined, {
      expectedAction: 'report',
      config: config({ secret: '', siteKey: '' }),
      fetcher,
    })).resolves.toEqual({ ok: true, skipped: true, errorCodes: [] })
    expect(fetcher).not.toHaveBeenCalled()
    expect(mocks.ship).not.toHaveBeenCalled()
  })

  it('fails closed and logs once when enforced but the keys are missing',
    async () => {
      const options = {
        expectedAction: 'report',
        config: config({ secret: '', enforced: true }),
        fetcher: respond({ success: true }),
      }
      const failure = {
        ok: false,
        skipped: false,
        errorCodes: ['misconfigured'],
      }

      await expect(verifyTurnstileToken(TOKEN, options))
        .resolves.toEqual(failure)
      await expect(verifyTurnstileToken(undefined, options))
        .resolves.toEqual(failure)

      expect(options.fetcher).not.toHaveBeenCalled()
      expect(mocks.ship).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(mocks.ship.mock.calls)).not.toContain(TOKEN)
    })

  it('fails without a token when configured', async () => {
    const fetcher = respond({ success: true })

    await expect(verifyTurnstileToken('', {
      expectedAction: 'report',
      config: config(),
      fetcher,
    })).resolves.toEqual({
      ok: false,
      skipped: false,
      errorCodes: ['missing-input-response'],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts the secret, token and IP to Siteverify', async () => {
    const fetcher = respond({ 'success': true, 'error-codes': [] })

    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      remoteIp: '203.0.113.7',
      config: config(),
      fetcher,
    })).resolves.toEqual({ ok: true, skipped: false, errorCodes: [] })

    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    const form = init.body as FormData

    expect(url).toBe(TURNSTILE_SITEVERIFY_URL)
    expect(init.method).toBe('POST')
    expect(form.get('secret')).toBe('secret-key')
    expect(form.get('response')).toBe(TOKEN)
    expect(form.get('remoteip')).toBe('203.0.113.7')
  })

  it('returns the Siteverify error codes on failure', async () => {
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: config(),
      fetcher: respond({
        'success': false,
        'error-codes': ['timeout-or-duplicate'],
      }),
    })).resolves.toEqual({
      ok: false,
      skipped: false,
      errorCodes: ['timeout-or-duplicate'],
    })
  })

  it('fails closed on a network error or a non-2xx answer', async () => {
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: config(),
      fetcher: vi.fn(async () => {
        throw new Error('offline')
      }),
    })).resolves.toMatchObject({ ok: false, errorCodes: ['network-error'] })
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: config(),
      fetcher: respond({}, 502),
    })).resolves.toMatchObject({ ok: false, errorCodes: ['http-502'] })
  })

  it('ignores action and hostname unless enforced', async () => {
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: config(),
      fetcher: respond({
        success: true,
        action: '',
        hostname: 'example.com',
      }),
    })).resolves.toMatchObject({ ok: true })
  })

  it('checks the action and hostname when enforced', async () => {
    const enforced = config({ enforced: true })

    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: enforced,
      fetcher: respond({
        success: true,
        action: 'auth',
        hostname: 'besidka.com',
      }),
    })).resolves.toMatchObject({ ok: false, errorCodes: ['action-mismatch'] })
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: enforced,
      fetcher: respond({
        success: true,
        action: 'report',
        hostname: 'evil.example',
      }),
    })).resolves.toMatchObject({
      ok: false,
      errorCodes: ['hostname-mismatch'],
    })
    await expect(verifyTurnstileToken(TOKEN, {
      expectedAction: 'report',
      config: enforced,
      fetcher: respond({
        success: true,
        action: 'report',
        hostname: 'www.besidka.com',
      }),
    })).resolves.toEqual({ ok: true, skipped: false, errorCodes: [] })
  })
})

describe('isAllowedTurnstileHostname', () => {
  it('accepts the base host, its preview pattern and extra hosts', () => {
    const previews = config({
      baseUrl: 'https://besidka.chernenko.workers.dev',
      additionalHosts: 'staging.besidka.test',
    })

    expect(isAllowedTurnstileHostname(
      'pr-12-besidka.chernenko.workers.dev',
      previews,
    )).toBe(true)
    expect(isAllowedTurnstileHostname('staging.besidka.test', previews))
      .toBe(true)
    expect(isAllowedTurnstileHostname('other.workers.dev', previews))
      .toBe(false)
    expect(isAllowedTurnstileHostname(undefined, previews)).toBe(false)
  })
})
