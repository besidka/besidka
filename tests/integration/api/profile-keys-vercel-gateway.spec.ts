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
    '../../../server/api/v1/profiles/keys/vercel-gateway/index.get'
  )

  return module.default
}

async function getPostHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/vercel-gateway/index.post'
  )

  return module.default
}

async function getDeleteHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/vercel-gateway/index.delete'
  )

  return module.default
}

describe('vercel-gateway key API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    const fakeKv = createFakeKv()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('enforceKeysRateLimit', enforceKeysRateLimit)
    vi.stubGlobal('useKV', () => fakeKv)
    vi.stubGlobal('setResponseHeader', vi.fn())
    vi.stubGlobal('setResponseStatus', vi.fn())
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
  })

  it('rejects unauthenticated requests on every method', async () => {
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
      body: { apiKey: 'vck_test' },
    } as any)).rejects.toMatchObject({ statusCode: 401 })
    await expect(deleteHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects an empty apiKey with a 400', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const postHandler = await getPostHandler()

    await expect(postHandler({
      body: { apiKey: '' },
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid request body',
    })
  })

  it('round-trips saving, reading, and deleting the key', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()
    const deleteHandler = await getDeleteHandler()

    expect(await getHandler({} as any)).toEqual({ hasKey: false })

    await postHandler({ body: { apiKey: 'vck_real_key' } } as any)
    expect(dbMock.spies.insert).toHaveBeenCalledTimes(1)
    expect(dbMock.spies.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'vercel-gateway',
        apiKey: 'encrypted:vck_real_key',
      }),
    )

    expect(await getHandler({} as any)).toEqual({ hasKey: true })

    await postHandler({ body: { apiKey: 'vck_updated_key' } } as any)
    expect(dbMock.spies.update).toHaveBeenCalledTimes(1)
    expect(await getHandler({} as any)).toEqual({ hasKey: true })

    await deleteHandler({} as any)
    expect(dbMock.spies.deleteFn).toHaveBeenCalledTimes(1)
    expect(await getHandler({} as any)).toEqual({ hasKey: false })
  })

  it('never returns the stored key to the client', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const getHandler = await getGetHandler()
    const postHandler = await getPostHandler()

    await postHandler({ body: { apiKey: 'vck_secret_key' } } as any)

    const response = await getHandler({} as any)

    expect(JSON.stringify(response)).not.toContain('vck_secret_key')
    expect(response).toEqual({ hasKey: true })
  })

  it('returns 429 once the POST rate limit is exceeded', async () => {
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)

    const postHandler = await getPostHandler()

    for (let call = 0; call < 10; call++) {
      await postHandler({ body: { apiKey: `vck_${call}` } } as any)
    }

    await expect(postHandler({
      body: { apiKey: 'vck_over_limit' },
    } as any)).rejects.toMatchObject({
      message: 'Too many requests',
      status: 429,
    })
  })
})
