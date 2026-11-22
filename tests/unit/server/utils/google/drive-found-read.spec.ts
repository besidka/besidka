import { describe, expect, it, vi } from 'vitest'
import { readFoundDriveFile } from '~~/server/utils/google/drive-found-read'

const FILE_ID = '1FoundFoundFoundFoundFoundFound01'

function fakeDrive(mimeType: string, exported: string) {
  return vi.fn(async (input: string) => {
    const url = new URL(input)

    if (url.pathname.endsWith('/export')) {
      return new Response(exported)
    }

    return new Response(JSON.stringify({
      id: FILE_ID,
      name: 'Budget',
      mimeType,
      modifiedTime: '2026-11-20T10:00:00.000Z',
      capabilities: { canDownload: true },
    }))
  })
}

describe('readFoundDriveFile', () => {
  it('tells the model that a found Sheet is only its first sheet in CSV',
    async () => {
      const result = await readFoundDriveFile(FILE_ID, {
        accessToken: 'token',
        fetchImpl: fakeDrive(
          'application/vnd.google-apps.spreadsheet',
          'a,b\n1,2\n',
        ),
      })

      expect(result).toMatchObject({
        status: 'ok',
        text: 'a,b\n1,2\n',
        note: 'Only the first sheet is included.',
      })
    })

  it('adds no such note to a Doc', async () => {
    const result = await readFoundDriveFile(FILE_ID, {
      accessToken: 'token',
      fetchImpl: fakeDrive(
        'application/vnd.google-apps.document',
        '# Plan\n',
      ),
    })

    expect(result).toMatchObject({ status: 'ok', text: '# Plan\n' })
    expect(result).not.toHaveProperty('note')
  })
})
