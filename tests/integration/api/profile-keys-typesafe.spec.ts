import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enforceKeysRateLimit } from '../../../server/utils/keys-rate-limit'

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

function createFakeKv() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

function createDbMock() {
  let storedApiKey: string | null = null

  const findFirst = vi.fn().mockImplementation(async () => {
    return storedApiKey !== null ? { apiKey: storedApiKey } : undefined
  })
  const insertValues = vi.fn().mockImplementation(async (values: {
    apiKey: string
  }) => {
    storedApiKey = values.apiKey
  })
  const insert = vi.fn(() => ({ values: insertValues }))
  const updateWhere = vi.fn().mockImplementation(async () => undefined)
  const updateSet = vi.fn((values: { apiKey: string }) => {
    storedApiKey = values.apiKey

    return { where: updateWhere }
  })
  const update = vi.fn(() => ({ set: updateSet }))
  const deleteWhere = vi.fn().mockImplementation(async () => {
    storedApiKey = null
  })
  const deleteFn = vi.fn(() => ({ where: deleteWhere }))

  return {
    db: {
      query: {
        keys: { findFirst },
      },
      insert,
      update,
      delete: deleteFn,
    },
    spies: {
      findFirst,
      insert,
      insertValues,
      update,
      updateSet,
      deleteFn,
      deleteWhere,
    },
  }
}

async function getGetHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/typesafe/index.get'
  )

  return module.default
}

async function getPostHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/typesafe/index.post'
  )

  return module.default
}

async function getDeleteHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/typesafe/index.delete'
  )

  return module.default
}

describe('TypeSafe AI key API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    const fakeKv = createFakeKv()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('enforceKeysRateLimit', enforceKeysRateLimit)
    vi.stubGlobal('useKV', () => fakeKv)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return `encrypted:${plain}`
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (encrypted: string) => {
      return encrypted.replace(/^encrypted:/, '')
    }))
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal(
      'readValidatedBody',
      async (event: any, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    fetchMock.mockReset().mockResolvedValue(new Response('{}', {
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('rejects unauthenticated requests on every method without calling '
    + 'TypeSafe AI', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()
    const deleteHandler = await getDeleteHandler()

    await expect(getHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    await expect(postHandler({
      body: { apiKey: 'ts-test' },
    } as any)).rejects.toMatchObject({ statusCode: 401 })
    await expect(deleteHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the key with GET /v1/models and saves it encrypted', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()

    await postHandler({ body: { apiKey: 'ts-real-key' } } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer ts-real-key' },
      }),
    )
    expect(dbMock.spies.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'typesafe',
        apiKey: 'encrypted:ts-real-key',
      }),
    )
    expect(await getHandler({} as any)).toEqual({ hasKey: true })
  })

  it.each([401, 403])(
    'refuses a key TypeSafe AI answers %i for, with a why and a fix',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('{}', { status }))

      const dbMock = createDbMock()

      vi.stubGlobal('useDb', () => dbMock.db)

      const postHandler = await getPostHandler()

      await expect(postHandler({
        body: { apiKey: 'ts-revoked-key' },
      } as any)).rejects.toMatchObject({
        status: 400,
        message: 'TypeSafe AI rejected this API key',
        why: expect.stringContaining('401 Unauthorized'),
        fix: expect.stringContaining('console.typesafe.ai/keys'),
      })
      expect(dbMock.spies.insert).not.toHaveBeenCalled()
      expect(dbMock.spies.update).not.toHaveBeenCalled()
    },
  )

  it('still saves the key when TypeSafe AI is down or unreachable',
    async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockRejectedValueOnce(new TypeError('fetch failed'))

      const dbMock = createDbMock()

      vi.stubGlobal('useDb', () => dbMock.db)

      const postHandler = await getPostHandler()

      await postHandler({ body: { apiKey: 'ts-first-key' } } as any)
      await postHandler({ body: { apiKey: 'ts-second-key' } } as any)

      expect(dbMock.spies.insert).toHaveBeenCalledTimes(1)
      expect(dbMock.spies.updateSet).toHaveBeenCalledWith({
        apiKey: 'encrypted:ts-second-key',
      })
    })

  it('deletes the key', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()
    const deleteHandler = await getDeleteHandler()

    await postHandler({ body: { apiKey: 'ts-real-key' } } as any)
    await deleteHandler({} as any)

    expect(dbMock.spies.deleteFn).toHaveBeenCalledTimes(1)
    expect(await getHandler({} as any)).toEqual({ hasKey: false })
  })

  it('never returns the stored key to the client', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()

    await postHandler({ body: { apiKey: 'ts-secret-key' } } as any)

    const response = await getHandler({} as any)

    expect(JSON.stringify(response)).not.toContain('ts-secret-key')
  })
})
