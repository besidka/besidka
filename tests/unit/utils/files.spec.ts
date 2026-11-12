import { describe, expect, it } from 'vitest'
import {
  LEGACY_OFFICE_ACCEPT_EXTENSIONS,
  LEGACY_OFFICE_UPLOAD_HINT,
  OFFICE_ACCEPT_EXTENSIONS,
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
  formatUploadFormatLabels,
  getLegacyOfficeMessage,
  getSafeFileLinks,
  getUploadFormatLabel,
  isLegacyOfficeFile,
  getUnsupportedInputMessage,
  isMediaTypeRejectedByModel,
  getFileUrl,
  truncateFilename,
  truncateFilenameMiddle,
} from '../../../app/utils/files'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.wordprocessingml.document'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.spreadsheetml.sheet'
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.presentationml.presentation'

describe('Office uploads', () => {
  it('sets the Office media type by extension whatever the browser sent', () => {
    const cases: Array<[string, string, string]> = [
      ['plan.docx', '', DOCX_TYPE],
      ['plan.docx', 'application/zip', DOCX_TYPE],
      ['plan.docx', 'application/octet-stream', DOCX_TYPE],
      ['budget.xlsx', '', XLSX_TYPE],
      ['budget.XLSX', 'application/zip', XLSX_TYPE],
      ['deck.pptx', 'application/x-zip-compressed', PPTX_TYPE],
      ['deck.pptx', PPTX_TYPE, PPTX_TYPE],
    ]

    for (const [name, declaredType, expectedType] of cases) {
      const file = new File(['PK'], name, { type: declaredType })

      expect(resolveUploadMediaType(file)).toBe(expectedType)
      expect(normalizeUploadFile(file).type).toBe(expectedType)
      expect(normalizeUploadFile(file).name).toBe(name)
    }
  })

  it('leaves a correct Office file untouched', () => {
    const file = new File(['PK'], 'plan.docx', { type: DOCX_TYPE })

    expect(normalizeUploadFile(file)).toBe(file)
  })

  it('does not turn a CSV that Windows calls Excel into an Office file', () => {
    const file = new File(['a,b'], 'data.csv', {
      type: 'application/vnd.ms-excel',
    })

    expect(resolveUploadMediaType(file)).toBe('text/csv')
  })

  it('spots legacy and macro Office files by extension, not media type', () => {
    for (const name of [
      'old.xls',
      'old.doc',
      'old.ppt',
      'macro.xlsm',
      'macro.docm',
      'macro.pptm',
      'OLD.XLS',
    ]) {
      expect(isLegacyOfficeFile({ name })).toBe(true)
    }

    for (const name of ['new.xlsx', 'new.docx', 'data.csv', 'notes.txt']) {
      expect(isLegacyOfficeFile({ name })).toBe(false)
    }
  })

  it('tells the user to save a legacy file in the new format', () => {
    expect(LEGACY_OFFICE_UPLOAD_HINT)
      .toBe('Save it as .xlsx / .docx / .pptx and upload again.')
    expect(getLegacyOfficeMessage(['old.xls'])).toBe(
      'old.xls is an old Office format and cannot be read. '
      + 'Save it as .xlsx / .docx / .pptx and upload again.',
    )
    expect(getLegacyOfficeMessage(['a.xls', 'b.doc', 'c.ppt', 'd.xls']))
      .toBe(
        '4 files are old Office formats and cannot be read: '
        + 'a.xls, b.doc, c.ppt.... '
        + 'Save it as .xlsx / .docx / .pptx and upload again.',
      )
  })

  it('lists the extensions the picker should show', () => {
    expect(OFFICE_ACCEPT_EXTENSIONS).toEqual(['.docx', '.xlsx', '.pptx'])
    expect(LEGACY_OFFICE_ACCEPT_EXTENSIONS).toEqual(expect.arrayContaining([
      '.doc',
      '.xls',
      '.ppt',
      '.docm',
      '.xlsm',
      '.pptm',
    ]))
  })
})

describe('upload format labels', () => {
  it('uses readable names, never the media type', () => {
    expect(getUploadFormatLabel(DOCX_TYPE)).toBe('Word')
    expect(getUploadFormatLabel(XLSX_TYPE)).toBe('Excel')
    expect(getUploadFormatLabel(PPTX_TYPE)).toBe('PowerPoint')
    expect(getUploadFormatLabel('application/pdf')).toBe('PDF')
    expect(getUploadFormatLabel('image/png')).toBe('PNG')
    expect(getUploadFormatLabel('image/jpeg')).toBe('JPEG')
    expect(getUploadFormatLabel('image/webp')).toBe('WebP')
    expect(getUploadFormatLabel('text/plain')).toBe('Text')
    expect(getUploadFormatLabel('text/markdown')).toBe('Markdown')
    expect(getUploadFormatLabel('text/csv')).toBe('CSV')
    expect(getUploadFormatLabel('text/tab-separated-values')).toBe('TSV')
  })

  it('falls back to the upper-cased subtype for an unknown type', () => {
    expect(getUploadFormatLabel('image/avif')).toBe('AVIF')
  })

  it('orders images, PDF, Office, then text, without repeats', () => {
    const labels = formatUploadFormatLabels([
      'text/plain',
      DOCX_TYPE,
      'image/png',
      XLSX_TYPE,
      'application/pdf',
      PPTX_TYPE,
      'text/csv',
      'text/plain',
    ])

    expect(labels).toBe('PNG, PDF, Word, Excel, PowerPoint, Text, CSV')
    expect(labels).not.toContain('vnd')
    expect(labels).not.toContain('openxmlformats')
  })
})

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
