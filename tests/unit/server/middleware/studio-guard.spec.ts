import { beforeEach, describe, expect, it, vi } from 'vitest'

const INSECURE_SECRET = 'd41d8cd98f00b204e9800998ecf8427e'
const STRONG_SECRET = 'a-long-random-runtime-secret-value'

const mocks = vi.hoisted(() => {
  return {
    sessionSecret: undefined as string | undefined,
    logError: vi.fn(),
    sendRedirect: vi.fn(
      (_event: unknown, location: string, status?: number) => {
        return { location, status }
      },
    ),
  }
})

vi.mock('evlog', () => {
  return {
    createError: (input: { message: string, status?: number }) => {
      const exception = new Error(input.message)

      Object.assign(exception, input)

      return exception
    },
    log: { error: mocks.logError },
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
    sendRedirect: mocks.sendRedirect,
  }
})

function createEvent(path: string) {
  return {
    url: new URL(path, 'https://besidka.com'),
    res: { headers: new Headers() },
  }
}

type Handler = (event: ReturnType<typeof createEvent>) => unknown

async function loadHandler(isDev = false): Promise<Handler> {
  vi.resetModules()

  const module = await import('~~/server/middleware/00.studio-guard')

  return module.createStudioGuard({
    isDev,
    readSessionSecret: () => mocks.sessionSecret,
  }) as Handler
}

const IPX_BASE = '/__nuxt_studio/ipx/_'

describe('studio-guard middleware', () => {
  beforeEach(() => {
    mocks.sessionSecret = STRONG_SECRET
    mocks.logError.mockClear()
    mocks.sendRedirect.mockClear()
  })

  describe('unrelated paths', () => {
    it.each([
      '/',
      '/api/v1/chats',
      '/_nuxt/entry.js',
      '/_studios',
      '/studio',
      '/__nuxt_studios/ipx',
    ])('ignores %s even with an insecure secret', async (path) => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler()
      const event = createEvent(path)

      expect(await handler(event)).toBeUndefined()
      expect(mocks.logError).not.toHaveBeenCalled()
      expect([...event.res.headers.keys()]).toEqual([])
    })
  })

  describe('percent-encoded studio prefix', () => {
    it.each([
      '/%5f%5fnuxt_studio/meta',
      '/%5F%5Fnuxt_studio/auth/session',
      '/%5Fstudio',
      '/%5Fstudio/',
      '/__nuxt_%73tudio/meta',
      '/%5f%5fnuxt_studio%2Fmeta',
      '/%5f%5fnuxt_studio/%E0%A4%A',
    ])('answers 404 for %s with an insecure secret', async (path) => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler()

      expect(() => handler(createEvent(path))).toThrowError(
        expect.objectContaining({ status: 404 }),
      )
    })

    it.each([
      '/%5Fstudio?redirect=%2F%5Cevil.example',
      '/%5Fstudio/?redirect=%2F%2Fevil.example',
    ])('redirects %s to the bare studio route', async (path) => {
      const handler = await loadHandler()
      const event = createEvent(path)

      expect(await handler(event)).toEqual({
        location: '/_studio',
        status: 302,
      })
    })

    it('rejects a remote ipx id behind an encoded prefix', async () => {
      const handler = await loadHandler()
      const event = createEvent(
        '/%5f%5fnuxt_studio/ipx/_/https%3A%2F%2Fevil.example%2Fx.svg',
      )

      expect(() => handler(event)).toThrowError(
        expect.objectContaining({ status: 404 }),
      )
    })

    it('still ignores encoded lookalike prefixes', async () => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler()

      expect(await handler(createEvent('/%5Fstudios'))).toBeUndefined()
      expect(await handler(createEvent('/%2F_studio'))).toBeUndefined()
    })
  })

  describe('insecure session secret', () => {
    it.each([
      '/_studio',
      '/_studio/',
      '/__nuxt_studio/auth/github',
      '/__nuxt_studio/auth/session',
      '/__nuxt_studio/meta',
      `${IPX_BASE}/images/logo.png`,
    ])('answers 404 for %s', async (path) => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler()

      expect(() => handler(createEvent(path))).toThrowError(
        expect.objectContaining({ status: 404 }),
      )
    })

    it('answers 404 when the secret is missing', async () => {
      mocks.sessionSecret = undefined

      const handler = await loadHandler()

      expect(() => handler(createEvent('/_studio'))).toThrowError(
        expect.objectContaining({ status: 404 }),
      )
    })

    it('logs once with the fix hint and never leaks it in the error', async () => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler()

      for (const path of ['/_studio', '/__nuxt_studio/meta']) {
        let thrown: Record<string, unknown> | undefined

        try {
          handler(createEvent(path))
        } catch (exception) {
          thrown = exception as Record<string, unknown>
        }

        expect(thrown?.why).toBeUndefined()
        expect(thrown?.fix).toBeUndefined()
      }

      expect(mocks.logError).toHaveBeenCalledTimes(1)
      expect(mocks.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          fix: expect.stringContaining('NUXT_STUDIO_AUTH_SESSION_SECRET'),
        }),
      )
    })

    it('does not enforce the secret in development', async () => {
      mocks.sessionSecret = INSECURE_SECRET

      const handler = await loadHandler(true)

      expect(await handler(createEvent('/_studio'))).toBeUndefined()
      expect(mocks.logError).not.toHaveBeenCalled()
    })

    it('does not block a strong secret', async () => {
      const handler = await loadHandler()

      expect(await handler(createEvent('/_studio'))).toBeUndefined()
      expect(mocks.logError).not.toHaveBeenCalled()
    })
  })

  describe('/__nuxt_studio/ipx/**', () => {
    it.each([
      `${IPX_BASE}/https%3A%2F%2Fevil.example%2Fx.svg`,
      `${IPX_BASE}/https:/evil.example/x.svg`,
      `${IPX_BASE}/https://evil.example/x.svg`,
      `${IPX_BASE}/http%3A%2F%2F127.0.0.1%2Fx.svg`,
      `${IPX_BASE}/HTTPS%3A%2F%2Fevil.example%2Fx.svg`,
      `${IPX_BASE}/data%3Aimage%2Fsvg%2Bxml%2C%3Csvg%2F%3E`,
      `${IPX_BASE}/javascript%3Aalert(1)`,
      `${IPX_BASE}/%2F%2Fevil.example%2Fx.svg`,
      `${IPX_BASE}/%5C%5Cevil.example%5Cx.svg`,
      `${IPX_BASE}/%2Fhttps%3A%2F%2Fevil.example%2Fx.svg`,
      `${IPX_BASE}/%E0%A4%A`,
    ])('answers 404 for %s', async (path) => {
      const handler = await loadHandler()
      const event = createEvent(path)

      expect(() => handler(event)).toThrowError(
        expect.objectContaining({ status: 404 }),
      )
      expect(event.res.headers.has('content-security-policy')).toBe(false)
    })

    it.each([
      `${IPX_BASE}/images/logo.png`,
      `${IPX_BASE}/%2Fimages%2Flogo.png`,
      '/__nuxt_studio/ipx/w_200/images/a.webp',
    ])('serves %s with sandbox headers', async (path) => {
      const handler = await loadHandler()
      const event = createEvent(path)

      expect(await handler(event)).toBeUndefined()
      expect(event.res.headers.get('content-security-policy'))
        .toBe('sandbox; default-src \'none\'')
      expect(event.res.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('keeps the editor routes free of the sandbox headers', async () => {
      const handler = await loadHandler()

      for (const path of [
        '/_studio',
        '/__nuxt_studio/meta',
        '/__nuxt_studio/auth/session',
      ]) {
        const event = createEvent(path)

        await handler(event)

        expect(event.res.headers.has('content-security-policy')).toBe(false)
        expect(event.res.headers.has('x-content-type-options')).toBe(false)
      }
    })
  })

  describe('/_studio redirect parameter', () => {
    it.each([
      '/_studio?redirect=%2Fchats%2Fnew',
      '/_studio?redirect=/',
      '/_studio?redirect=',
      '/_studio',
      '/_studio?done=1',
    ])('passes %s through', async (path) => {
      const handler = await loadHandler()

      expect(await handler(createEvent(path))).toBeUndefined()
      expect(mocks.sendRedirect).not.toHaveBeenCalled()
    })

    it.each([
      '/_studio?redirect=%2F%5Cevil.example',
      '/_studio?redirect=%2F%255Cevil.example',
      '/_studio?redirect=%2F%2Fevil.example',
      '/_studio?redirect=https%3A%2F%2Fevil.example',
      '/_studio?redirect=%2F%09%2Fevil.example',
      '/_studio?redirect=%2F%0D%0Aevil',
      '/_studio?redirect=evil',
      '/_studio?redirect=%2Fok&redirect=%2Fother',
      '/_studio/?redirect=%2F%5Cevil.example',
    ])('redirects %s to the bare studio route', async (path) => {
      const handler = await loadHandler()
      const event = createEvent(path)

      expect(await handler(event)).toEqual({
        location: '/_studio',
        status: 302,
      })
      expect(mocks.sendRedirect).toHaveBeenCalledWith(event, '/_studio', 302)
    })

    it('does not inspect the redirect parameter on other studio routes', async () => {
      const handler = await loadHandler()

      expect(
        await handler(createEvent('/__nuxt_studio/meta?redirect=//evil')),
      ).toBeUndefined()
      expect(mocks.sendRedirect).not.toHaveBeenCalled()
    })
  })
})
