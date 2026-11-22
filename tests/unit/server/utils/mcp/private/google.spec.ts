import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoogleConnectionRecord } from '~~/server/utils/google/store'
import {
  disconnectMcpGoogle,
  listMcpGoogleConnections,
} from '~~/server/utils/mcp/private/google'

const mocks = vi.hoisted(() => {
  return {
    isGoogleByoAllowed: vi.fn(),
    disconnectGoogleConnection: vi.fn(),
    readGoogleConnection: vi.fn(),
  }
})

vi.mock('~~/server/utils/google/byo-access', () => {
  return { isGoogleByoAllowed: mocks.isGoogleByoAllowed }
})

vi.mock('~~/server/utils/google/connection', () => {
  return { disconnectGoogleConnection: mocks.disconnectGoogleConnection }
})

vi.mock('~~/server/utils/google/store', () => {
  return { readGoogleConnection: mocks.readGoogleConnection }
})

const SECRET_EMAIL = 'owner@example.com'
const SECRET_SUBJECT = 'google-subject-123456789'
const SECRET_CONNECTION_ID = 'connection-id-abcdef'

const context = {
  db: { marker: 'db' } as never,
  userId: 42,
  logger: { set: vi.fn() },
}

function buildRecord(
  overrides: Partial<GoogleConnectionRecord> = {},
): GoogleConnectionRecord {
  return {
    id: SECRET_CONNECTION_ID,
    userId: 42,
    clientMode: 'besidka',
    googleSubject: SECRET_SUBJECT,
    googleEmail: SECRET_EMAIL,
    grantedScopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/drive.file',
    ],
    status: 'active',
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    updatedAt: new Date('2026-11-21T10:00:00.000Z'),
    ...overrides,
  }
}

function mockRecords(records: Partial<Record<string, GoogleConnectionRecord>>) {
  mocks.readGoogleConnection.mockImplementation(
    async (_db: unknown, _userId: number, clientMode: string) => {
      return records[clientMode] ?? null
    },
  )
}

describe('listMcpGoogleConnections', () => {
  beforeEach(() => {
    mocks.isGoogleByoAllowed.mockReset()
    mocks.readGoogleConnection.mockReset()
    mocks.isGoogleByoAllowed.mockResolvedValue(false)
    context.logger.set.mockReset()
  })

  it('lists Besidka\'s mode as not connected when there is no row',
    async () => {
      mockRecords({})

      const result = await listMcpGoogleConnections(context)

      expect(result).toEqual({
        connections: [{
          clientMode: 'besidka',
          connected: false,
          status: null,
          capabilities: [],
          connectedAt: null,
        }],
      })
    })

  it('lists an active connection with its capabilities and date',
    async () => {
      mockRecords({ besidka: buildRecord() })

      const result = await listMcpGoogleConnections(context)

      expect(result.connections).toEqual([{
        clientMode: 'besidka',
        connected: true,
        status: 'active',
        capabilities: ['identity', 'drive-picked'],
        connectedAt: '2026-11-20T10:00:00.000Z',
      }])
    })

  it('reports a connection that needs re-authorization without '
    + 'capabilities', async () => {
    mockRecords({ besidka: buildRecord({ status: 'needs_reauth' }) })

    const result = await listMcpGoogleConnections(context)

    expect(result.connections).toEqual([{
      clientMode: 'besidka',
      connected: true,
      status: 'needs_reauth',
      capabilities: [],
      connectedAt: '2026-11-20T10:00:00.000Z',
    }])
  })

  it('reads a revoked row as not connected', async () => {
    mockRecords({ besidka: buildRecord({ status: 'revoked' }) })

    const result = await listMcpGoogleConnections(context)

    expect(result.connections).toEqual([{
      clientMode: 'besidka',
      connected: false,
      status: null,
      capabilities: [],
      connectedAt: null,
    }])
  })

  it('lists both modes for an admin who passes the owner gate', async () => {
    mocks.isGoogleByoAllowed.mockResolvedValue(true)
    mockRecords({
      besidka: buildRecord(),
      byo: buildRecord({
        clientMode: 'byo',
        grantedScopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
      }),
    })

    const result = await listMcpGoogleConnections(context)

    expect(result.connections.map((connection) => {
      return connection.clientMode
    })).toEqual(['besidka', 'byo'])
    expect(result.connections[1]).toMatchObject({
      clientMode: 'byo',
      connected: true,
      status: 'active',
      capabilities: ['identity', 'drive-read', 'gmail-read'],
    })
  })

  it('lists the owner mode as not connected for an admin without a row',
    async () => {
      mocks.isGoogleByoAllowed.mockResolvedValue(true)
      mockRecords({ besidka: buildRecord() })

      const result = await listMcpGoogleConnections(context)

      expect(result.connections[1]).toEqual({
        clientMode: 'byo',
        connected: false,
        status: null,
        capabilities: [],
        connectedAt: null,
      })
    })

  it('hides the owner mode from a caller who fails the gate, even with a '
    + 'stored connection, and never reads its row', async () => {
    mockRecords({
      besidka: buildRecord(),
      byo: buildRecord({ clientMode: 'byo' }),
    })

    const result = await listMcpGoogleConnections(context)

    expect(result.connections).toHaveLength(1)
    expect(result.connections[0]!.clientMode).toBe('besidka')
    expect(mocks.readGoogleConnection).toHaveBeenCalledTimes(1)
    expect(mocks.readGoogleConnection).not.toHaveBeenCalledWith(
      expect.anything(),
      42,
      'byo',
    )
  })

  it('hides the owner mode when the gate cannot be checked', async () => {
    mocks.isGoogleByoAllowed.mockRejectedValue(new Error('kv down'))
    mockRecords({ byo: buildRecord({ clientMode: 'byo' }) })

    const result = await listMcpGoogleConnections(context)

    expect(result.connections.map((connection) => {
      return connection.clientMode
    })).toEqual(['besidka'])
    expect(context.logger.set).toHaveBeenCalledWith({
      attributes: {
        google: { byoGate: 'unavailable', byoGateError: 'Error' },
      },
    })
  })

  it('never puts the email, subject, id or any token field in the result',
    async () => {
      mocks.isGoogleByoAllowed.mockResolvedValue(true)
      mockRecords({
        besidka: buildRecord(),
        byo: buildRecord({ clientMode: 'byo', status: 'needs_reauth' }),
      })

      const serialized = JSON.stringify(
        await listMcpGoogleConnections(context),
      )

      expect(serialized).not.toContain(SECRET_EMAIL)
      expect(serialized).not.toContain(SECRET_SUBJECT)
      expect(serialized).not.toContain(SECRET_CONNECTION_ID)
      expect(serialized).not.toMatch(/googleapis\.com/)
      expect(serialized).not.toMatch(
        /email|subject|token|secret|clientId|scope/i,
      )
    })

  it('passes the gate the caller\'s id', async () => {
    mockRecords({})

    await listMcpGoogleConnections(context)

    expect(mocks.isGoogleByoAllowed).toHaveBeenCalledWith({
      db: context.db,
      userId: 42,
      logger: context.logger,
    })
  })
})

describe('disconnectMcpGoogle', () => {
  beforeEach(() => {
    mocks.isGoogleByoAllowed.mockReset()
    mocks.disconnectGoogleConnection.mockReset()
    mocks.disconnectGoogleConnection.mockResolvedValue({
      disconnected: true,
      revoked: true,
      filesDeleted: 3,
      filesPending: false,
    })
  })

  it('calls the shared disconnect function once for the chosen mode',
    async () => {
      const result = await disconnectMcpGoogle(
        context,
        { clientMode: 'besidka' },
      )

      expect(mocks.disconnectGoogleConnection).toHaveBeenCalledTimes(1)
      expect(mocks.disconnectGoogleConnection).toHaveBeenCalledWith({
        db: context.db,
        userId: 42,
        clientMode: 'besidka',
        logger: context.logger,
      })
      expect(result).toEqual({
        disconnected: true,
        revoked: true,
        filesDeleted: 3,
        filesPending: false,
      })
    })

  it('reports an unconfirmed revoke and pending files as they are',
    async () => {
      mocks.disconnectGoogleConnection.mockResolvedValue({
        disconnected: true,
        revoked: false,
        filesDeleted: 1,
        filesPending: true,
      })

      const result = await disconnectMcpGoogle(context, { clientMode: 'byo' })

      expect(result).toEqual({
        disconnected: true,
        revoked: false,
        filesDeleted: 1,
        filesPending: true,
      })
    })

  it('does not check the owner gate, so a former admin can disconnect the '
    + 'owner\'s mode', async () => {
    mocks.isGoogleByoAllowed.mockResolvedValue(false)

    await expect(disconnectMcpGoogle(context, { clientMode: 'byo' }))
      .resolves.toMatchObject({ disconnected: true })
    expect(mocks.isGoogleByoAllowed).not.toHaveBeenCalled()
    expect(mocks.disconnectGoogleConnection).toHaveBeenCalledWith(
      expect.objectContaining({ clientMode: 'byo' }),
    )
  })

  it('answers the same 404 for a mode that is not connected, whichever '
    + 'mode it is', async () => {
    mocks.disconnectGoogleConnection.mockResolvedValue({
      disconnected: false,
      revoked: false,
      filesDeleted: 0,
      filesPending: false,
    })

    const besidka = await disconnectMcpGoogle(
      context,
      { clientMode: 'besidka' },
    ).catch((exception: unknown) => exception as Error)
    const byo = await disconnectMcpGoogle(context, { clientMode: 'byo' })
      .catch((exception: unknown) => exception as Error)

    expect(besidka).toMatchObject({ status: 404 })
    expect(byo).toMatchObject({ status: 404 })
    expect((besidka as Error).message).toBe((byo as Error).message)
    expect((byo as Error).message).toContain('list_google_connections')
  })

  it('never returns the connection id, email or a token', async () => {
    mocks.disconnectGoogleConnection.mockResolvedValue({
      disconnected: true,
      revoked: true,
      filesDeleted: 0,
      filesPending: false,
      connectionId: SECRET_CONNECTION_ID,
      email: SECRET_EMAIL,
    })

    const serialized = JSON.stringify(
      await disconnectMcpGoogle(context, { clientMode: 'besidka' }),
    )

    expect(serialized).not.toContain(SECRET_CONNECTION_ID)
    expect(serialized).not.toContain(SECRET_EMAIL)
  })
})
