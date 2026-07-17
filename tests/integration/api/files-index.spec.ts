import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  like: vi.fn(),
  and: vi.fn(),
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()

  return {
    ...actual,
    eq: mocks.eq,
    like: mocks.like,
    and: mocks.and,
  }
})

function createSelectChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    offset: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  }

  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.orderBy.mockReturnValue(chain)
  chain.offset.mockReturnValue(chain)
  chain.limit.mockResolvedValue(result)
  chain.get.mockResolvedValue(result)

  return chain
}

async function getHandler() {
  const module = await import('../../../server/api/v1/files/index.get')

  return module.default
}

describe('files index API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn())
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    mocks.eq.mockImplementation((_column, value) => ({ operation: 'eq', value }))
    mocks.like.mockImplementation((_column, value) => ({
      operation: 'like',
      value,
    }))
    mocks.and.mockImplementation((...conditions) => ({
      operation: 'and',
      conditions,
    }))
  })

  it('composes generated source filtering with ownership and search', async () => {
    const filesChain = createSelectChain([])
    const countChain = createSelectChain({ count: 0 })
    const select = vi.fn()
      .mockReturnValueOnce(filesChain)
      .mockReturnValueOnce(countChain)

    vi.stubGlobal('getQuery', () => ({
      source: 'assistant',
      search: 'chart',
    }))
    vi.stubGlobal('useDb', () => ({ select }))

    const handler = await getHandler()
    const result = await handler({} as any)

    expect(result).toEqual({
      files: [],
      total: 0,
      offset: 0,
      limit: 20,
    })
    expect(mocks.eq).toHaveBeenCalledWith(expect.anything(), 1)
    expect(mocks.eq).toHaveBeenCalledWith(expect.anything(), 'assistant')
    expect(mocks.like).toHaveBeenCalledWith(expect.anything(), '%chart%')
    expect(filesChain.where).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'and',
    }))
    expect(countChain.where).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'and',
    }))
  })

  it('rejects an unknown source filter', async () => {
    vi.stubGlobal('getQuery', () => ({ source: 'provider' }))
    vi.stubGlobal('useDb', vi.fn())

    const handler = await getHandler()

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
    })
  })
})
