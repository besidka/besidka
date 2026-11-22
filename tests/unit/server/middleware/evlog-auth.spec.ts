import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestLoggerSet: vi.fn(),
  serverLoggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.requestLoggerSet }),
}))

vi.mock('~~/server/utils/files/logger', () => ({
  resolveServerLogger: () => ({ set: mocks.serverLoggerSet }),
}))

const ENDED_REQUEST_MESSAGE = 'This promise was created by a request that '
  + 'has since ended, so it can never settle.'

const session = {
  user: { id: 7, email: 'person@example.com', name: 'Person' },
  session: { id: 70, expiresAt: new Date('2026-12-01T00:00:00.000Z') },
}

function createEvent(path: string, eventContext: Record<string, unknown>) {
  return {
    context: eventContext,
    req: {
      headers: new Headers({ cookie: 'better-auth.session_token=secret' }),
    },
    url: new URL(`https://besidka.com${path}`),
  }
}

async function runMiddleware(path: string) {
  const eventContext: Record<string, unknown> = {}
  const event = createEvent(path, eventContext)

  vi.stubGlobal('useEvent', () => event)

  const module = await import('~~/server/middleware/evlog-auth')

  await (module.default as (input: unknown) => Promise<void>)(event)

  return eventContext
}

describe('evlog-auth middleware', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    mocks.requestLoggerSet.mockClear()
    mocks.serverLoggerSet.mockClear()
  })

  it('never builds the auth instance on a path it skips', async () => {
    const useServerAuth = vi.fn()

    vi.stubGlobal('useServerAuth', useServerAuth)

    await runMiddleware('/api/_nuxt_icon/lucide.json')
    await runMiddleware('/api/auth/get-session')

    expect(useServerAuth).not.toHaveBeenCalled()
  })

  it('reads the current auth instance on every request', async () => {
    const firstGetSession = vi.fn().mockResolvedValue(null)
    const secondGetSession = vi.fn().mockResolvedValue(session)
    const useServerAuth = vi.fn()
      .mockReturnValueOnce({ api: { getSession: firstGetSession } })
      .mockReturnValueOnce({ api: { getSession: secondGetSession } })

    vi.stubGlobal('useServerAuth', useServerAuth)

    const module = await import('~~/server/middleware/evlog-auth')
    const handler = module.default as (input: unknown) => Promise<void>
    const firstEvent = createEvent('/api/v1/features', {})
    const secondContext: Record<string, unknown> = {}
    const secondEvent = createEvent('/api/v1/features', secondContext)

    vi.stubGlobal('useEvent', () => firstEvent)
    await handler(firstEvent)
    vi.stubGlobal('useEvent', () => secondEvent)
    await handler(secondEvent)

    expect(firstGetSession).toHaveBeenCalledTimes(1)
    expect(secondGetSession).toHaveBeenCalledTimes(1)
    expect(secondContext.authSession).toBe(session)
  })

  it('drops a poisoned auth instance and identifies the user on a fresh one',
    async () => {
      const poisonedGetSession = vi.fn()
        .mockRejectedValue(new Error(ENDED_REQUEST_MESSAGE))
      const freshGetSession = vi.fn().mockResolvedValue(session)
      let currentGetSession = poisonedGetSession
      const dropServerAuth = vi.fn(() => {
        currentGetSession = freshGetSession
      })

      vi.stubGlobal('useServerAuth', () => ({
        api: { getSession: currentGetSession },
      }))
      vi.stubGlobal('dropServerAuth', dropServerAuth)

      const eventContext = await runMiddleware('/api/v1/profiles/settings')

      expect(dropServerAuth).toHaveBeenCalledTimes(1)
      expect(eventContext.authSession).toBe(session)
      expect(mocks.serverLoggerSet).toHaveBeenCalledWith({
        attributes: {
          authInit: { endedRequestPromise: true, retried: true },
        },
      })
    })
})
