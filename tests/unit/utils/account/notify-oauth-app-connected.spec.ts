import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendOAuthAppConnectedEmail: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/account/security-emails', () => ({
  sendOAuthAppConnectedEmail: mocks.sendOAuthAppConnectedEmail,
}))

function stubClientLookup(rows: Array<{ name: string | null }>) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))

  vi.stubGlobal('useDb', () => ({ select }))

  return { select, limit }
}

async function importNotify() {
  return import('../../../../server/utils/account/notify-oauth-app-connected')
}

describe('notifyOAuthAppConnected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('emails the app name, scopes and the connected apps link', async () => {
    stubClientLookup([{ name: 'Claude' }])

    const { notifyOAuthAppConnected } = await importNotify()

    await notifyOAuthAppConnected({
      user: { email: 'user@example.com' },
      clientId: 'client-1',
      scopes: ['openid', 'chats:read'],
    })

    expect(mocks.sendOAuthAppConnectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { email: 'user@example.com' },
        appName: 'Claude',
        scopes: ['openid', 'chats:read'],
        connectedAppsUrl: expect.stringMatching(
          /^https?:\/\/[^/]+\/profile\/connected-apps$/,
        ),
      }),
    )
  })

  it('falls back to no name when the client row is gone', async () => {
    stubClientLookup([])

    const { notifyOAuthAppConnected } = await importNotify()

    await notifyOAuthAppConnected({
      user: { email: 'user@example.com' },
      clientId: 'client-1',
      scopes: [],
    })

    expect(mocks.sendOAuthAppConnectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ appName: undefined }),
    )
  })

  it('does nothing without a client id', async () => {
    const { select } = stubClientLookup([])
    const { notifyOAuthAppConnected } = await importNotify()

    await notifyOAuthAppConnected({
      user: { email: 'user@example.com' },
      clientId: null,
      scopes: [],
    })

    expect(select).not.toHaveBeenCalled()
    expect(mocks.sendOAuthAppConnectedEmail).not.toHaveBeenCalled()
  })
})
