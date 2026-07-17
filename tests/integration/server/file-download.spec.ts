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

  it('uses the stored media type for converted image extensions', async () => {
    vi.stubGlobal('getQuery', () => ({ download: '1' }))
    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'file-1',
            userId: 1,
            storageKey: 'generated-key',
            name: 'holiday-photo.jpg',
            type: 'image/webp',
            size: 12,
          }),
        },
      },
    }))

    const handler = await getHandler()

    await handler({} as any)

    const headers = setResponseHeaders.mock.calls[0]?.[1]

    expect(headers?.['Content-Type']).toBe('image/webp')
    expect(headers?.['Content-Disposition']).toContain(
      'filename="holiday-photo.webp"',
    )
    expect(headers?.['Content-Disposition']).toContain(
      'filename*=UTF-8\'\'holiday-photo.webp',
    )
  })

  it.each([
    ['photo.webp', 'image/jpeg', 'photo.jpg'],
    ['scan.jpg', 'image/png', 'scan.png'],
    ['document.txt', 'application/pdf', 'document.pdf'],
    ['notes.pdf', 'text/plain; charset=utf-8', 'notes.txt'],
  ])(
    'normalizes %s as %s to %s',
    async (fileName, mediaType, expectedFileName) => {
      const { buildDownloadFileName } = await import(
        '../../../server/routes/files/[key].get'
      )

      expect(buildDownloadFileName(fileName, mediaType))
        .toBe(expectedFileName)
    },
  )

  it('truncates long Unicode filenames without splitting code points', async () => {
    const { buildAttachmentContentDisposition } = await import(
      '../../../server/routes/files/[key].get'
    )
    const disposition = buildAttachmentContentDisposition(
      `${'a'.repeat(194)}😀.jpg`,
      'image/webp',
    )

    expect(disposition).toContain(
      `filename*=UTF-8''${'a'.repeat(194)}%F0%9F%98%80.webp`,
    )
  })

  it('uses a readable legacy fallback for Unicode-only filenames', async () => {
    const { buildAttachmentContentDisposition } = await import(
      '../../../server/routes/files/[key].get'
    )
    const disposition = buildAttachmentContentDisposition(
      '文件.jpg',
      'image/webp',
    )

    expect(disposition).toContain('filename="download.webp"')
    expect(disposition).toContain(
      'filename*=UTF-8\'\'%E6%96%87%E4%BB%B6.webp',
    )
  })

  it('removes bidi controls that could reorder the visible extension', async () => {
    const { buildAttachmentContentDisposition } = await import(
      '../../../server/routes/files/[key].get'
    )
    const disposition = buildAttachmentContentDisposition(
      'report\u202Egpj.jpg',
      'image/webp',
    )

    expect(disposition).toContain('filename="reportgpj.webp"')
    expect(disposition).toContain(
      'filename*=UTF-8\'\'reportgpj.webp',
    )
    expect(disposition).not.toContain('%E2%80%AE')
  })

  it('removes lone UTF-16 surrogates before encoding the header', async () => {
    const { buildAttachmentContentDisposition } = await import(
      '../../../server/routes/files/[key].get'
    )
    const disposition = buildAttachmentContentDisposition(
      'broken\uD800-\uDFFF.jpg',
      'image/webp',
    )

    expect(disposition).toContain('filename="broken-.webp"')
    expect(disposition).toContain(
      'filename*=UTF-8\'\'broken-.webp',
    )
  })

  it('keeps a safe basename while replacing its extension', async () => {
    const { buildAttachmentContentDisposition } = await import(
      '../../../server/routes/files/[key].get'
    )
    const disposition = buildAttachmentContentDisposition(
      '../\u0000private/Żółty "las".jpg',
      'image/webp',
    )

    expect(disposition).toContain(
      'filename="Zoty _las_.webp"',
    )
    expect(disposition).toContain(
      'filename*=UTF-8\'\'%C5%BB%C3%B3%C5%82ty%20%22las%22.webp',
    )
    expect(disposition).not.toContain('/')
    expect(disposition).not.toContain('\u0000')
  })
})
