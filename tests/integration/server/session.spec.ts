import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
}))

async function getUseUserSession() {
  const module = await import('../../../server/utils/session')

  return module.useUserSession
}

describe('useUserSession', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('useServerAuth', vi.fn(() => ({
      api: { getSession: mocks.getSession },
    })))
    vi.stubGlobal('getHeaders', vi.fn(() => ({})))
    vi.stubGlobal('getHeader', vi.fn(() => ''))
  })

  it('returns the middleware-cached session without calling getSession',
    async () => {
      const cachedSession = {
        user: { id: 'user-1' },
        session: { id: 'session-1' },
      }

      vi.stubGlobal('useEvent', () => ({
        context: { authSession: cachedSession },
      }))

      const useUserSession = await getUseUserSession()
      const session = await useUserSession()

      expect(session).toBe(cachedSession)
      expect(mocks.getSession).not.toHaveBeenCalled()
    })

  it('falls back to resolving a session when none is cached', async () => {
    const resolvedSession = {
      user: { id: 'user-2' },
      session: { id: 'session-2' },
    }

    mocks.getSession.mockResolvedValue(resolvedSession)
    vi.stubGlobal('useEvent', () => ({ context: {} }))

    const useUserSession = await getUseUserSession()
    const session = await useUserSession()

    expect(session).toBe(resolvedSession)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it('logs the issue #235 diagnostic when no session is cached and '
    + 'getSession resolves to null', async () => {
    mocks.getSession.mockResolvedValue(null)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('getHeader', vi.fn(() => 'better-auth.session_token=abc'))

    const useUserSession = await getUseUserSession()
    const session = await useUserSession()

    expect(session).toBeNull()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      sessionCheck: {
        resolved: false,
        tokenCookiePresent: true,
      },
    })
  })
})
