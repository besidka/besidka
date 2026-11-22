import { describe, expect, it, vi } from 'vitest'
import {
  classifyDriveFailure,
  downloadDriveFile,
  exportDriveFile,
  fetchDriveFileMetadata,
} from '~~/server/utils/google/drive'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz-_0123456789'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('Drive API calls', () => {
  it('asks for metadata with shared drives and the resource key header',
    async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({
        id: FILE_ID,
        name: 'Plan',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: '2026-11-20T10:00:00.123Z',
        version: '7',
        capabilities: { canDownload: true },
      }))
      const result = await fetchDriveFileMetadata(FILE_ID, {
        accessToken: 'token-1',
        resourceKey: 'key_123',
        fetchImpl,
      })
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]

      expect(url).toContain(`/drive/v3/files/${FILE_ID}?`)
      expect(url).toContain('supportsAllDrives=true')
      expect(init.headers).toMatchObject({
        'authorization': 'Bearer token-1',
        'X-Goog-Drive-Resource-Keys': `${FILE_ID}/key_123`,
      })
      expect(result).toMatchObject({
        ok: true,
        metadata: {
          id: FILE_ID,
          name: 'Plan',
          version: '7',
          canDownload: true,
          size: null,
        },
      })
      expect(result.ok && result.metadata.modifiedTime?.toISOString())
        .toBe('2026-11-20T10:00:00.123Z')
    })

  it('sends no resource key header when there is none', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: FILE_ID,
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: '2048',
    }))
    const result = await fetchDriveFileMetadata(FILE_ID, {
      accessToken: 'token-1',
      fetchImpl,
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]

    expect(JSON.stringify(init.headers)).not.toContain('Resource-Keys')
    expect(result.ok && result.metadata.size).toBe(2048)
  })

  it.each([
    ['../../etc', undefined],
    ['abc', undefined],
    [FILE_ID, 'bad key'],
    [FILE_ID, 'a/b'],
    [`${FILE_ID}?alt=media`, undefined],
  ])('refuses the id %s with key %s before any request', async (id, key) => {
    const fetchImpl = vi.fn()

    await expect(fetchDriveFileMetadata(id, {
      accessToken: 'token-1',
      resourceKey: key,
      fetchImpl,
    })).rejects.toThrow(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns Google\'s status and reason for a failed lookup', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: { errors: [{ reason: 'notFound' }] },
    }, 404))

    expect(await fetchDriveFileMetadata(FILE_ID, {
      accessToken: 'token-1',
      fetchImpl,
    })).toEqual({ ok: false, status: 404, reason: 'notFound' })
  })

  it('exports with the export type and no shared-drive parameter',
    async () => {
      const fetchImpl = vi.fn(async () => new Response('# Title'))
      const result = await exportDriveFile(FILE_ID, 'text/markdown', {
        accessToken: 'token-1',
        maxBytes: 1024,
        fetchImpl,
      })
      const [url] = fetchImpl.mock.calls[0] as unknown as [string]

      expect(result.ok).toBe(true)
      expect(url).toBe(
        `https://www.googleapis.com/drive/v3/files/${FILE_ID}/export`
        + '?mimeType=text%2Fmarkdown',
      )
    })

  it('downloads media with shared drives enabled', async () => {
    const fetchImpl = vi.fn(async () => new Response('bytes'))

    await downloadDriveFile(FILE_ID, {
      accessToken: 'token-1',
      maxBytes: 1024,
      fetchImpl,
    })

    const [url] = fetchImpl.mock.calls[0] as unknown as [string]

    expect(url).toContain('alt=media')
    expect(url).toContain('supportsAllDrives=true')
  })

  it.each([
    [401, null, 'reauthorize'],
    [404, null, 'not_found'],
    [403, 'exportSizeLimitExceeded', 'export_too_large'],
    [403, 'downloadRestricted', 'not_downloadable'],
    [403, 'cannotDownloadFile', 'not_downloadable'],
    [403, 'insufficientFilePermissions', 'not_found'],
    [403, 'userRateLimitExceeded', 'failed'],
    [500, null, 'failed'],
  ] as const)('classifies %s %s as %s', (status, reason, code) => {
    expect(classifyDriveFailure(status, reason)).toBe(code)
  })
})
