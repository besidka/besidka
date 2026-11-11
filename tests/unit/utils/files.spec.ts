import { describe, expect, it } from 'vitest'
import {
  TEXT_FILE_PREVIEW_MAX_BYTES,
  TEXT_FILE_VIEW_MAX_BYTES,
  addFileDownloadQuery,
  convertFilesToUIParts,
  countTextLines,
  getTextPreviewLines,
  isTextFileType,
  normalizeUploadFile,
  resolveUploadMediaType,
  getFileDownloadUrl,
  getFileIcon,
  getSafeFileLinks,
  getUnsupportedInputMessage,
  isMediaTypeRejectedByModel,
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

  describe('getUnsupportedInputMessage', () => {
    const everything = () => true
    const textAndImages = (type: string) => type !== 'application/pdf'
    const textAndPdf = (type: string) => !type.startsWith('image/')
    const textOnly = (type: string) => type.startsWith('text/')

    it('suggests PDF or text when only images are rejected', () => {
      expect(getUnsupportedInputMessage(['image/png'], textAndPdf)).toBe(
        'This model does not support image input. '
        + 'Attach a PDF or text file instead, or switch models.',
      )
    })

    it('suggests only text when images are rejected and PDFs are unsupported', () => {
      expect(getUnsupportedInputMessage(['image/png'], textOnly)).toBe(
        'This model does not support image input. '
        + 'Attach a text file instead, or switch models.',
      )
    })

    it('names PDF when a PDF is rejected and images are unsupported', () => {
      expect(
        getUnsupportedInputMessage(['application/pdf'], textOnly),
      ).toBe(
        'This model does not support PDF input. '
        + 'Attach a text file instead, or switch models.',
      )
    })

    it('suggests an image when a PDF is rejected and images are supported', () => {
      expect(
        getUnsupportedInputMessage(['application/pdf'], textAndImages),
      ).toBe(
        'This model does not support PDF input. '
        + 'Attach an image or text file instead, or switch models.',
      )
    })

    it('combines both kinds when images and PDFs are rejected', () => {
      expect(
        getUnsupportedInputMessage(
          ['image/png', 'application/pdf', 'image/webp'],
          textOnly,
        ),
      ).toBe(
        'This model does not support image or PDF input. '
        + 'Attach a text file instead, or switch models.',
      )
    })

    it('does not suggest a rejected kind when the predicate is permissive', () => {
      expect(getUnsupportedInputMessage(['image/png'], everything)).toBe(
        'This model does not support image input. '
        + 'Attach a PDF or text file instead, or switch models.',
      )
    })
  })

  describe('isMediaTypeRejectedByModel', () => {
    const textOnly = (type: string) => type.startsWith('text/')

    it('rejects images and PDFs the model cannot read', () => {
      expect(isMediaTypeRejectedByModel('image/png', textOnly)).toBe(true)
      expect(isMediaTypeRejectedByModel('application/pdf', textOnly))
        .toBe(true)
    })

    it('never rejects text or unrelated types', () => {
      expect(isMediaTypeRejectedByModel('text/plain', textOnly)).toBe(false)
      expect(isMediaTypeRejectedByModel('application/zip', textOnly))
        .toBe(false)
    })

    it('accepts media the model can read', () => {
      expect(isMediaTypeRejectedByModel('image/png', () => true)).toBe(false)
    })
  })

  describe('text file helpers', () => {
    it('recognises text media types', () => {
      expect(isTextFileType('text/plain')).toBe(true)
      expect(isTextFileType('text/markdown')).toBe(true)
      expect(isTextFileType('text/plain; charset=utf-8')).toBe(true)
      expect(isTextFileType('application/pdf')).toBe(false)
      expect(isTextFileType('image/png')).toBe(false)
    })

    it('resolves the upload media type from the name when it is empty', () => {
      expect(resolveUploadMediaType(new File(['x'], 'notes.md')))
        .toBe('text/markdown')
      expect(resolveUploadMediaType(new File(['x'], 'NOTES.MARKDOWN')))
        .toBe('text/markdown')
      expect(resolveUploadMediaType(new File(['x'], 'notes.txt')))
        .toBe('text/plain')
      expect(resolveUploadMediaType(new File(['x'], 'archive.zip')))
        .toBe('')
    })

    it('resolves CSV and TSV uploads, including the types Windows browsers report', () => {
      expect(resolveUploadMediaType(new File(['x'], 'cities.csv')))
        .toBe('text/csv')
      expect(resolveUploadMediaType(new File(['x'], 'cities.TSV')))
        .toBe('text/tab-separated-values')
      expect(resolveUploadMediaType(
        new File(['x'], 'cities.csv', { type: 'text/csv' }),
      )).toBe('text/csv')
      expect(resolveUploadMediaType(
        new File(['x'], 'cities.csv', { type: 'application/vnd.ms-excel' }),
      )).toBe('text/csv')
      expect(resolveUploadMediaType(
        new File(['x'], 'sheet.xls', { type: 'application/vnd.ms-excel' }),
      )).toBe('application/vnd.ms-excel')
      expect(isTextFileType('text/csv')).toBe(true)
    })

    it('maps the markdown alias and keeps a declared type', () => {
      expect(resolveUploadMediaType(
        new File(['x'], 'a.md', { type: 'text/x-markdown' }),
      )).toBe('text/markdown')
      expect(resolveUploadMediaType(
        new File(['x'], 'a.md', { type: 'application/pdf' }),
      )).toBe('application/pdf')
    })

    it('normalises an untyped markdown file and keeps typed files as is',
      async () => {
        const untyped = new File(['# Title'], 'notes.md', {
          lastModified: 42,
        })
        const normalized = normalizeUploadFile(untyped)
        const typed = new File(['x'], 'photo.png', { type: 'image/png' })

        expect(normalized.type).toBe('text/markdown')
        expect(normalized.name).toBe('notes.md')
        expect(normalized.lastModified).toBe(42)
        expect(await normalized.text()).toBe('# Title')
        expect(normalizeUploadFile(typed)).toBe(typed)
      })

    it('counts lines without a phantom trailing line', () => {
      expect(countTextLines('')).toBe(0)
      expect(countTextLines('one')).toBe(1)
      expect(countTextLines('one\ntwo')).toBe(2)
      expect(countTextLines('one\ntwo\n')).toBe(2)
    })

    it('previews the first non-empty lines, trimmed and shortened', () => {
      expect(getTextPreviewLines('\n  a  \n\nb\nc\nd')).toEqual([
        '  a',
        'b',
        'c',
      ])
      expect(getTextPreviewLines('x'.repeat(100), 3, 10)).toEqual([
        'x'.repeat(10),
      ])
    })

    it('keeps the preview limit below the view limit', () => {
      expect(TEXT_FILE_PREVIEW_MAX_BYTES).toBeLessThan(TEXT_FILE_VIEW_MAX_BYTES)
    })
  })
})
