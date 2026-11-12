import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  containsLikeEscaped: vi.fn(),
  and: vi.fn(),
}))

vi.mock('~~/server/utils/db/like', () => ({
  containsLikeEscaped: mocks.containsLikeEscaped,
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()

  return {
    ...actual,
    eq: mocks.eq,
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
    mocks.containsLikeEscaped.mockImplementation((_column, value) => ({
      operation: 'contains',
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
    expect(mocks.containsLikeEscaped).toHaveBeenCalledWith(
      expect.anything(),
      'chart',
    )
    expect(filesChain.where).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'and',
    }))
    expect(countChain.where).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'and',
    }))
  })

  it.each(['project', 'library'])('accepts the %s source filter', async (source) => {
    const filesChain = createSelectChain([])
    const countChain = createSelectChain({ count: 0 })
    const select = vi.fn()
      .mockReturnValueOnce(filesChain)
      .mockReturnValueOnce(countChain)

    vi.stubGlobal('getQuery', () => ({ source }))
    vi.stubGlobal('useDb', () => ({ select }))

    const handler = await getHandler()
    const result = await handler({} as any)

    expect(result).toMatchObject({ files: [], total: 0 })
    expect(mocks.eq).not.toHaveBeenCalledWith(expect.anything(), source)
    expect(filesChain.where).toHaveBeenCalledTimes(1)
    expect(countChain.where).toHaveBeenCalledTimes(1)
  })

  it('returns the extracted-text state and a truncation hint', async () => {
    const baseRow = {
      storageKey: 'a.docx',
      name: 'a.docx',
      size: 10,
      type: 'application/octet-stream',
      source: 'upload',
      expiresAt: null,
      createdAt: new Date(),
      originModel: null,
      generationCost: null,
      documentId: null,
      documentCreatedVia: null,
      documentAiGenerated: null,
    }
    const filesChain = createSelectChain([
      { ...baseRow, id: 'f1', textStatus: 'ready', textBytes: 1024 },
      { ...baseRow, id: 'f2', textStatus: 'ready', textBytes: 300 * 1024 },
      { ...baseRow, id: 'f3', textStatus: 'failed', textBytes: null },
      { ...baseRow, id: 'f4', textStatus: null, textBytes: null },
    ])
    const countChain = createSelectChain({ count: 4 })
    const select = vi.fn()
      .mockReturnValueOnce(filesChain)
      .mockReturnValueOnce(countChain)

    vi.stubGlobal('getQuery', () => ({}))
    vi.stubGlobal('useDb', () => ({ select }))

    const handler = await getHandler()
    const result = await handler({} as any)

    expect(result.files.map((file: any) => {
      return [file.textStatus, file.textBytes, file.textTruncated]
    })).toEqual([
      ['ready', 1024, false],
      ['ready', 300 * 1024, true],
      ['failed', null, false],
      [null, null, false],
    ])
  })

  it('returns how many images and charts the text leaves out', async () => {
    const baseRow = {
      storageKey: 'a.docx',
      name: 'a.docx',
      size: 10,
      type: 'application/octet-stream',
      source: 'upload',
      expiresAt: null,
      createdAt: new Date(),
      originModel: null,
      generationCost: null,
      documentId: null,
      documentCreatedVia: null,
      documentAiGenerated: null,
      textStatus: 'ready',
      textBytes: 1024,
    }
    const filesChain = createSelectChain([
      { ...baseRow, id: 'f1', textOmittedMedia: 3, textOmittedCharts: 0 },
      { ...baseRow, id: 'f2', textOmittedMedia: 0, textOmittedCharts: 2 },
      { ...baseRow, id: 'f3', textOmittedMedia: null, textOmittedCharts: null },
    ])
    const countChain = createSelectChain({ count: 3 })
    const select = vi.fn()
      .mockReturnValueOnce(filesChain)
      .mockReturnValueOnce(countChain)

    vi.stubGlobal('getQuery', () => ({}))
    vi.stubGlobal('useDb', () => ({ select }))

    const handler = await getHandler()
    const result = await handler({} as any)

    expect(result.files.map((file: any) => {
      return [file.textOmittedMedia, file.textOmittedCharts]
    })).toEqual([
      [3, 0],
      [0, 2],
      [null, null],
    ])
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
