import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  fakeDecrypt,
  fakeEncrypt,
} from '../../../../setup/helpers/connectors-oauth'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  compareAndDeleteConnectorCredentials,
  compareAndSetConnectorTokens,
  createConnector,
  listUserConnectorCredentials,
  readConnectorCredentials,
  replaceConnectorCredentials,
  saveConnectorCredentials,
} = await import('~~/server/utils/connectors/store')

describe('connector token store', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let connectorId: string

  async function read() {
    return await readConnectorCredentials(testDb.db, userId, connectorId)
  }

  async function save(issuer: string, accessToken: string) {
    await replaceConnectorCredentials(testDb.db, {
      userId,
      connectorId,
      issuer,
      clientRegistration: { clientId: 'c', registrationKind: 'dcr' },
      accessToken,
      refreshToken: `refresh-${accessToken}`,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))

    const connector = await createConnector(testDb.db, {
      userId,
      title: 'Example',
      url: 'https://mcp.example.com/mcp',
      slugBase: 'example',
      createdVia: 'app',
    })

    connectorId = connector.id
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('replaces the rows of every issuer with one row', async () => {
    await saveConnectorCredentials(testDb.db, {
      userId,
      connectorId,
      issuer: 'https://old.example.com',
      accessToken: 'old',
    })
    await save('https://new.example.com', 'new')

    const rows = await listUserConnectorCredentials(testDb.db, userId)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issuer: 'https://new.example.com',
      accessToken: 'new',
      connectorHost: 'mcp.example.com',
    })
  })

  it('refuses to replace credentials of another user\'s connector',
    async () => {
      await expect(replaceConnectorCredentials(testDb.db, {
        userId: otherUserId,
        connectorId,
        issuer: '',
        headerName: 'X-Key',
        headerValue: 'x',
      })).rejects.toMatchObject({ status: 404 })
    })

  it('writes refreshed tokens only for the expected generation', async () => {
    await save('https://auth.example.com', 'first')

    const before = await read()
    const update = {
      userId,
      connectorId,
      expectedGeneration: before!.generation,
      accessToken: 'second',
      refreshToken: 'refresh-second',
      scope: 'read',
      expiresAt: new Date(Date.now() + 60_000),
    }

    expect(await compareAndSetConnectorTokens(testDb.db, update)).toBe(true)
    expect(await compareAndSetConnectorTokens(testDb.db, {
      ...update,
      accessToken: 'stale',
    })).toBe(false)

    const after = await read()

    expect(after!.accessToken).toBe('second')
    expect(after!.generation).not.toBe(before!.generation)
  })

  it('tells two writes in the same second apart', async () => {
    await save('https://auth.example.com', 'same')

    const first = await read()

    await save('https://auth.example.com', 'same')

    const second = await read()

    expect(second!.generation).not.toBe(first!.generation)
  })

  it('never writes another user\'s row', async () => {
    await save('https://auth.example.com', 'first')

    const before = await read()

    expect(await compareAndSetConnectorTokens(testDb.db, {
      userId: otherUserId,
      connectorId,
      expectedGeneration: before!.generation,
      accessToken: 'hijack',
      refreshToken: null,
      scope: null,
      expiresAt: null,
    })).toBe(false)
  })

  it('deletes only the expected generation', async () => {
    await save('https://auth.example.com', 'first')

    const before = await read()

    await save('https://auth.example.com', 'second')

    expect(await compareAndDeleteConnectorCredentials(testDb.db, {
      userId,
      connectorId,
      expectedGeneration: before!.generation,
    })).toBe(false)

    const current = await read()

    expect(await compareAndDeleteConnectorCredentials(testDb.db, {
      userId,
      connectorId,
      expectedGeneration: current!.generation,
    })).toBe(true)
    expect(await read())
      .toBeNull()
  })
})
