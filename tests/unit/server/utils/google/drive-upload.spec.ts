import { describe, expect, it, vi } from 'vitest'
import {
  buildDriveMultipartBody,
  createDriveFile,
} from '~~/server/utils/google/drive-upload'

function decode(body: Uint8Array): string {
  return Buffer.from(body).toString('latin1')
}

describe('buildDriveMultipartBody', () => {
  it('puts the JSON metadata first and the bytes second', () => {
    const body = decode(buildDriveMultipartBody({
      boundary: 'b0',
      name: 'Report.md',
      mediaType: 'text/markdown; charset=utf-8',
      bytes: new TextEncoder().encode('# Hi'),
    }))

    expect(body).toBe(
      '--b0\r\n'
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + '{"name":"Report.md"}\r\n'
      + '--b0\r\n'
      + 'Content-Type: text/markdown\r\n\r\n'
      + '# Hi\r\n'
      + '--b0--',
    )
  })

  it('keeps binary bytes intact', () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 45, 45])
    const body = buildDriveMultipartBody({
      boundary: 'b0',
      name: 'x.bin',
      mediaType: 'application/octet-stream',
      bytes,
    })
    const start = body.length - '\r\n--b0--'.length - bytes.length

    expect([...body.slice(start, start + bytes.length)]).toEqual([...bytes])
  })

  it('never lets a media type inject a header', () => {
    const body = decode(buildDriveMultipartBody({
      boundary: 'b0',
      name: 'x',
      mediaType: 'text/plain\r\nX-Evil: 1',
      bytes: new Uint8Array([1]),
    }))

    expect(body).not.toContain('X-Evil')
    expect(body).toContain('Content-Type: application/octet-stream')
  })

  it('escapes a name that carries quotes', () => {
    const body = decode(buildDriveMultipartBody({
      boundary: 'b0',
      name: 'a"b\n.md',
      mediaType: 'text/plain',
      bytes: new Uint8Array([1]),
    }))

    expect(body).toContain('{"name":"a\\"b\\n.md"}')
  })
})

describe('createDriveFile', () => {
  const input = {
    accessToken: 'token-1',
    name: 'Report.md',
    mediaType: 'text/markdown',
    bytes: new TextEncoder().encode('# Hi'),
  }

  it('posts one multipart request to the upload path and returns the id',
    async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ id: 'drive-id-1' }))
      })
      const result = await createDriveFile({ ...input, fetchImpl })
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]

      expect(result).toEqual({ ok: true, driveFileId: 'drive-id-1' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(url).toBe(
        'https://www.googleapis.com/upload/drive/v3/files'
        + '?uploadType=multipart&supportsAllDrives=true',
      )
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('manual')
      expect((init.headers as Record<string, string>).authorization)
        .toBe('Bearer token-1')
      expect((init.headers as Record<string, string>)['content-type'])
        .toMatch(/^multipart\/related; boundary=besidka-[0-9a-f]{32}$/)
    })

  it('reports the status and reason of a Drive error', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({
        error: { errors: [{ reason: 'storageQuotaExceeded' }] },
      }), { status: 403 })
    })

    expect(await createDriveFile({ ...input, fetchImpl })).toEqual({
      ok: false,
      status: 403,
      reason: 'storageQuotaExceeded',
    })
  })

  it('treats a success without an id as a failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))

    expect(await createDriveFile({ ...input, fetchImpl })).toMatchObject({
      ok: false,
      status: 502,
    })
  })

  it('refuses a redirect from Google', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/' },
      })
    })

    await expect(createDriveFile({ ...input, fetchImpl })).rejects
      .toMatchObject({ status: 502 })
  })
})
