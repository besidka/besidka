import { describe, expect, it } from 'vitest'
import {
  addFileDownloadQuery,
  convertFilesToUIParts,
  getFileDownloadUrl,
  getFileIcon,
  getSafeFileLinks,
  getFileUrl,
  truncateFilename,
  truncateFilenameMiddle,
} from '../../../app/utils/files'

describe('files utils', () => {
  it('returns file URL by storage key', () => {
    expect(getFileUrl('abc123.webp')).toBe('/files/abc123.webp')
  })

  it('builds download URLs without dropping existing query parameters', () => {
    expect(getFileDownloadUrl('abc123.webp'))
      .toBe('/files/abc123.webp?download=1')
    expect(addFileDownloadQuery('/files/abc123.webp?preview=1#image'))
      .toBe('/files/abc123.webp?preview=1&download=1#image')
  })

  it('derives safe open and download links for tokenized shared files', () => {
    expect(getSafeFileLinks(
      '/files/shared.webp?token=header.payload.signature#preview',
    )).toEqual({
      storageKey: 'shared.webp',
      openUrl: '/files/shared.webp?token=header.payload.signature#preview',
      downloadUrl:
        '/files/shared.webp?token=header.payload.signature&download=1#preview',
    })
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    '//evil.example/file.webp',
    'https://evil.example/files/file.webp',
    '/files/%2e%2e%2fsecret',
    '/files/folder/file.webp',
    '/files/folder\\file.webp',
    '/files/',
    'http://[',
  ])('does not create actionable links from malformed URL %s', (url) => {
    expect(() => addFileDownloadQuery(url)).not.toThrow()
    expect(addFileDownloadQuery(url)).toBe('')
    expect(getSafeFileLinks(url)).toBeNull()
  })

  it('maps icons by mime type', () => {
    expect(getFileIcon('image/png')).toBe('lucide:image')
    expect(getFileIcon('application/pdf')).toBe('lucide:file-text')
    expect(getFileIcon('text/plain')).toBe('lucide:file-text')
    expect(getFileIcon('audio/mpeg')).toBe('lucide:music')
    expect(getFileIcon('video/mp4')).toBe('lucide:video')
    expect(getFileIcon('application/octet-stream')).toBe('lucide:file')
  })

  it('truncates long filename preserving extension', () => {
    expect(truncateFilename('very-long-screenshot-name.png', 14))
      .toBe('very-lo...png')
    expect(truncateFilename('short.txt', 14)).toBe('short.txt')
  })

  it('truncates filename in the middle', () => {
    expect(truncateFilenameMiddle('super-very-long-file-name.pdf', 18))
      .toBe('super-...-name.pdf')
    expect(truncateFilenameMiddle('note.txt', 18)).toBe('note.txt')
  })

  it('converts file metadata to UI parts', async () => {
    const parts = await convertFilesToUIParts([
      {
        id: 'f1',
        storageKey: 'f1.webp',
        name: 'photo.webp',
        size: 1000,
        type: 'image/webp',
      } as any,
    ])

    expect(parts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'photo.webp',
        url: '/files/f1.webp',
      },
    ])
  })
})
