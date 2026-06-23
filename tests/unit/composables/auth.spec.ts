import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

// Controllable getSession so each test drives the { data, error } shape the
// better-auth client actually returns (200/null, network error, success).
const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}))

vi.mock('better-auth/vue', () => ({
  createAuthClient: () => ({
    getSession: getSessionMock,
    $store: {
      listen: vi.fn(),
    },
    $ERROR_CODES: {},
    signIn: {},
    signUp: {},
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  }),
}))

const { useAuth } = await import('../../../app/composables/auth')

function fakeSession(id: string) {
  return { id } as unknown as NonNullable<
    ReturnType<typeof useAuth>['session']['value']
  >
}

function createDeferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return {
    promise,
    resolve,
  }
}

describe('useAuth fetchSession', () => {
  beforeEach(() => {
    resetMockNuxtState()
    installMockNuxtState()
    getSessionMock.mockReset()
  })

  afterEach(() => {
    resetMockNuxtState()
  })

  it('preserves the session on a transport-error result (no false logout)', async () => {
    const { fetchSession, session } = useAuth()

    session.value = fakeSession('sess-1')
    getSessionMock.mockResolvedValue({
      data: null,
      error: { status: 0, message: 'fetch failed' },
    })

    await fetchSession({ disableCookieCache: true })

    expect(session.value).toMatchObject({ id: 'sess-1' })
  })

  it('preserves the session when getSession throws (offline)', async () => {
    const { fetchSession, session } = useAuth()

    session.value = fakeSession('sess-1')
    getSessionMock.mockRejectedValue(new Error('Failed to fetch'))

    await fetchSession({ disableCookieCache: true })

    expect(session.value).toMatchObject({ id: 'sess-1' })
  })

  it('clears the session on an authoritative no-session response', async () => {
    const { fetchSession, session } = useAuth()

    session.value = fakeSession('sess-1')
    getSessionMock.mockResolvedValue({ data: null, error: null })

    await fetchSession({ disableCookieCache: true })

    expect(session.value).toBeNull()
  })

  it('sets the session on a successful response', async () => {
    const { fetchSession, session, user } = useAuth()

    getSessionMock.mockResolvedValue({
      data: {
        session: { id: 'sess-2' },
        user: { id: '7', name: 'Ada' },
      },
      error: null,
    })

    await fetchSession()

    expect(session.value?.id).toBe('sess-2')
    expect(user.value?.id).toBe('7')
  })

  it('de-dupes a concurrent normal fetch while one is in flight', async () => {
    const { fetchSession } = useAuth()
    let resolveGet: (value: { data: null, error: null }) => void = () => {}

    getSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve
      }),
    )

    const first = fetchSession()
    const second = fetchSession()

    resolveGet({ data: null, error: null })

    await Promise.all([first, second])

    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('lets a bypass fetch run even while a normal fetch is in flight', async () => {
    const { fetchSession } = useAuth()
    let resolveGet: (value: { data: null, error: null }) => void = () => {}

    getSessionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve
      }),
    )
    getSessionMock.mockResolvedValue({ data: null, error: null })

    const normal = fetchSession()
    const bypass = fetchSession({ disableCookieCache: true })

    resolveGet({ data: null, error: null })

    await Promise.all([normal, bypass])

    expect(getSessionMock).toHaveBeenCalledTimes(2)
  })

  it('passes disableCookieCache only on the bypass call', async () => {
    const { fetchSession } = useAuth()

    getSessionMock.mockResolvedValue({ data: null, error: null })

    await fetchSession()

    expect(getSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined }),
    )

    await fetchSession({ disableCookieCache: true })

    expect(getSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    )
  })

  it('detects a dead session via bypass even when the cached path reports alive', async () => {
    const { fetchSession, session } = useAuth()

    getSessionMock.mockImplementation((opts?: {
      query?: { disableCookieCache?: boolean }
    }) => {
      return Promise.resolve(
        opts?.query?.disableCookieCache
          ? { data: null, error: null }
          : {
            data: { session: { id: 'cached' }, user: { id: '1' } },
            error: null,
          },
      )
    })

    await fetchSession({ disableCookieCache: true })

    expect(session.value).toBeNull()
  })

  it('does not let a stale in-flight fetch overwrite a newer bypass result', async () => {
    const { fetchSession, session } = useAuth()
    const normalGet = createDeferred<{ data: unknown, error: null }>()
    const bypassGet = createDeferred<{ data: null, error: null }>()

    session.value = fakeSession('stale-alive')
    getSessionMock
      .mockReturnValueOnce(normalGet.promise)
      .mockReturnValueOnce(bypassGet.promise)

    const normal = fetchSession()
    const bypass = fetchSession({ disableCookieCache: true })

    // The newer bypass resolves first and finds no session.
    bypassGet.resolve({ data: null, error: null })
    await bypass

    expect(session.value).toBeNull()

    // The older normal fetch resolves later with a cached, truthy session — it
    // must NOT resurrect the session the bypass just found dead.
    normalGet.resolve({
      data: { session: { id: 'cached' }, user: { id: '1' } },
      error: null,
    })
    await normal

    expect(session.value).toBeNull()
  })
})
