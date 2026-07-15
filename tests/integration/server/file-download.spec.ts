import { beforeEach, describe, expect, it, vi } from 'vitest'

async function getHandler() {
  const module = await import('../../../server/routes/files/[key].get')

  return module.default
}

describe('private file download route', () => {
  const setResponseHeaders = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('getRouterParams', () => ({ key: 'generated-key' }))
    vi.stubGlobal('getQuery', vi.fn().mockReturnValue({}))
    vi.stubGlobal('getRequestHeader', vi.fn())
    vi.stubGlobal('setResponseHeaders', setResponseHeaders)
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'file-1',
            userId: 1,
            storageKey: 'generated-key',
            name: 'Żółty "las".webp',
            type: 'image/webp',
            size: 12,
          }),
        },
      },
    }))
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn().mockResolvedValue({ body: 'image-body' }),
    }))
  })

  it('keeps authenticated file display inline by default', async () => {
    const handler = await getHandler()
    const result = await handler({} as any)

    expect(result).toBe('image-body')
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'Content-Disposition': 'inline',
      }),
    )
  })

  it('uses safe RFC 5987 filenames when download is requested', async () => {
    vi.stubGlobal('getQuery', () => ({ download: '1' }))

    const handler = await getHandler()

    await handler({} as any)

    const headers = setResponseHeaders.mock.calls[0]?.[1]
    const disposition = headers?.['Content-Disposition']

    expect(disposition).toContain('attachment;')
    expect(disposition).toContain('filename="Zoty _las_.webp"')
    expect(disposition).toContain('filename*=UTF-8\'\'%C5%BB%C3%B3%C5%82ty')
    expect(disposition).not.toContain('\r')
    expect(disposition).not.toContain('\n')
  })
})
