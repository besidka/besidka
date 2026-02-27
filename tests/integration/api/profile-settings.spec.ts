import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SettingsRecord {
  id: number
  reasoningExpanded: boolean
}

function createDbMock() {
  let currentSettings: SettingsRecord | null = null

  const findFirst = vi.fn().mockImplementation(async () => {
    return currentSettings
  })
  const insertValues = vi.fn().mockImplementation(async (values: {
    userId: number
    reasoningExpanded: boolean
  }) => {
    currentSettings = {
      id: 1,
      reasoningExpanded: values.reasoningExpanded,
    }
  })
  const insert = vi.fn(() => ({
    values: insertValues,
  }))
  const updateWhere = vi.fn().mockImplementation(async () => {
    return undefined
  })
  const updateSet = vi.fn().mockImplementation((values: {
    reasoningExpanded: boolean
  }) => {
    currentSettings = {
      id: 1,
      reasoningExpanded: values.reasoningExpanded,
    }

    return {
      where: updateWhere,
    }
  })
  const update = vi.fn(() => ({
    set: updateSet,
  }))

  return {
    db: {
      query: {
        userSettings: {
          findFirst,
        },
      },
      insert,
      update,
    },
    spies: {
      findFirst,
      insert,
      insertValues,
      update,
      updateSet,
      updateWhere,
    },
  }
}

async function getSettingsHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/settings/index.get'
  )

  return module.default
}

async function patchSettingsHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/settings/index.patch'
  )

  return module.default
}

describe('profile settings API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
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
  })

  it('returns 401 for unauthorized requests', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(getHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    await expect(patchHandler({
      body: {
        reasoningExpanded: true,
      },
    } as any)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('returns default false when settings row does not exist', async () => {
    const handler = await getSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const response = await handler({} as any)

    expect(response).toEqual({
      reasoningExpanded: false,
    })
  })

  it('upserts settings and returns persisted value', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const firstPatchResponse = await patchHandler({
      body: {
        reasoningExpanded: true,
      },
    } as any)

    expect(firstPatchResponse).toEqual({
      reasoningExpanded: true,
    })
    expect(dbMock.spies.insert).toHaveBeenCalledTimes(1)

    const secondPatchResponse = await patchHandler({
      body: {
        reasoningExpanded: false,
      },
    } as any)

    expect(secondPatchResponse).toEqual({
      reasoningExpanded: false,
    })
    expect(dbMock.spies.update).toHaveBeenCalledTimes(1)

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
    })
  })

  it('returns 400 for invalid patch payload', async () => {
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    await expect(patchHandler({
      body: {
        reasoningExpanded: 'yes',
      },
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid request body',
    })
  })
})
