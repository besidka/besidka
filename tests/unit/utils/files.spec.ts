import { describe, expect, it } from 'vitest'
import {
  convertFilesToUIParts,
  getFileIcon,
  getFileUrl,
  truncateFilename,
  truncateFilenameMiddle,
} from '../../../app/utils/files'

describe('files utils', () => {
  it('returns file URL by storage key', () => {
    expect(getFileUrl('abc123.webp')).toBe('/files/abc123.webp')
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
