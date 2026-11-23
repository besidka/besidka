import { describe, expect, it } from 'vitest'
import {
  GOOGLE_FILE_DOWNLOADS,
  GOOGLE_FILE_DOWNLOAD_FORMATS,
  GOOGLE_FILE_DOWNLOAD_NAME_MAX,
  GOOGLE_FILE_DOWNLOAD_TYPES,
  buildGoogleFileDisposition,
  buildGoogleFileDownloadName,
  buildGoogleFileDownloadUrl,
  findGoogleFileDownloadOption,
  getGoogleFileDownloadOptions,
  isGoogleFileDownloadFormat,
} from '../../../shared/utils/google-file-download'

describe('the download allowlist', () => {
  it('offers the documented formats per kind and nothing else', () => {
    expect(GOOGLE_FILE_DOWNLOADS.document.map(option => option.format))
      .toEqual(['docx', 'txt'])
    expect(GOOGLE_FILE_DOWNLOADS.spreadsheet.map(option => option.format))
      .toEqual(['xlsx', 'csv'])
    expect(GOOGLE_FILE_DOWNLOADS.text.map(option => option.format))
      .toEqual(['txt'])
  })

  it('labels each choice in plain words, with CSV as the first sheet', () => {
    expect(GOOGLE_FILE_DOWNLOADS.document.map(option => option.label))
      .toEqual(['Download as Word (.docx)', 'Download as text (.txt)'])
    expect(GOOGLE_FILE_DOWNLOADS.spreadsheet.map(option => option.label))
      .toEqual([
        'Download as Excel (.xlsx)',
        'Download first sheet as CSV',
      ])
    expect(GOOGLE_FILE_DOWNLOADS.text[0]?.label).toBe('Download as text')
  })

  it('exports a document and a spreadsheet and reads a text file raw', () => {
    expect(findGoogleFileDownloadOption('document', 'docx')?.exportMimeType)
      .toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.'
        + 'document',
      )
    expect(findGoogleFileDownloadOption('document', 'txt')?.exportMimeType)
      .toBe('text/plain')
    expect(findGoogleFileDownloadOption('spreadsheet', 'xlsx')?.exportMimeType)
      .toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    expect(findGoogleFileDownloadOption('spreadsheet', 'csv')?.exportMimeType)
      .toBe('text/csv')
    expect(findGoogleFileDownloadOption('text', 'txt')?.exportMimeType)
      .toBeNull()
  })

  it.each([
    ['document', 'xlsx'],
    ['document', 'csv'],
    ['spreadsheet', 'docx'],
    ['spreadsheet', 'txt'],
    ['text', 'docx'],
    ['text', 'csv'],
    ['folder', 'docx'],
    ['document', 'pdf'],
  ])('refuses %s as %s', (kind, format) => {
    expect(findGoogleFileDownloadOption(kind, format)).toBeNull()
  })

  it('knows its formats and a content type for each', () => {
    for (const format of GOOGLE_FILE_DOWNLOAD_FORMATS) {
      expect(isGoogleFileDownloadFormat(format)).toBe(true)
      expect(GOOGLE_FILE_DOWNLOAD_TYPES[format].contentType).not.toBe('')
    }

    expect(isGoogleFileDownloadFormat('pdf')).toBe(false)
    expect(getGoogleFileDownloadOptions('unknown')).toEqual([])
  })

  it('builds a URL with the three query keys and no name or kind', () => {
    const url = buildGoogleFileDownloadUrl({
      chatSlug: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      fileId: 'abcdefghij1234567890',
      format: 'docx',
    })
    const parsed = new URL(url, 'https://besidka.com')

    expect(parsed.pathname).toBe('/api/v1/google/drive/created-files/download')
    expect([...parsed.searchParams.keys()])
      .toEqual(['chatSlug', 'fileId', 'format'])
  })
})

describe('buildGoogleFileDownloadName', () => {
  it('adds the extension of the chosen format', () => {
    expect(buildGoogleFileDownloadName('Quarterly plan', 'document', 'docx'))
      .toBe('Quarterly plan.docx')
    expect(buildGoogleFileDownloadName('Budget', 'spreadsheet', 'csv'))
      .toBe('Budget.csv')
  })

  it('does not repeat an extension the title already ends with', () => {
    expect(buildGoogleFileDownloadName('Plan.DOCX', 'document', 'docx'))
      .toBe('Plan.docx')
  })

  it('keeps the extension a text file already has', () => {
    expect(buildGoogleFileDownloadName('notes.md', 'text', 'txt'))
      .toBe('notes.md')
    expect(buildGoogleFileDownloadName('notes', 'text', 'txt'))
      .toBe('notes.txt')
    expect(buildGoogleFileDownloadName('Plan v1.2', 'document', 'docx'))
      .toBe('Plan v1.2.docx')
  })

  it('removes path parts, control and direction characters', () => {
    expect(buildGoogleFileDownloadName('../../etc/passwd', 'text', 'txt'))
      .toBe('etc passwd.txt')
    expect(buildGoogleFileDownloadName('C:\\temp\\a.txt', 'text', 'txt'))
      .toBe('C temp a.txt')
    expect(buildGoogleFileDownloadName('a\u0000b\u202Ec\r\nd', 'text', 'txt'))
      .toBe('a b c d.txt')
    expect(buildGoogleFileDownloadName('what?*<>|"', 'text', 'txt'))
      .toBe('what.txt')
  })

  it('never starts with a dot or ends with a dot or space', () => {
    expect(buildGoogleFileDownloadName('...hidden', 'document', 'docx'))
      .toBe('hidden.docx')
    expect(buildGoogleFileDownloadName('name . ', 'document', 'docx'))
      .toBe('name.docx')
  })

  it('falls back to Untitled when nothing is left', () => {
    expect(buildGoogleFileDownloadName('', 'document', 'docx'))
      .toBe('Untitled.docx')
    expect(buildGoogleFileDownloadName('///', 'spreadsheet', 'xlsx'))
      .toBe('Untitled.xlsx')
    expect(buildGoogleFileDownloadName('. . .', 'text', 'txt'))
      .toBe('Untitled.txt')
  })

  it('caps the whole name at 120 characters, by code point', () => {
    const name = buildGoogleFileDownloadName('x'.repeat(500), 'document', 'docx')
    const emoji = buildGoogleFileDownloadName('😀'.repeat(500), 'text', 'txt')

    expect(Array.from(name)).toHaveLength(GOOGLE_FILE_DOWNLOAD_NAME_MAX)
    expect(name.endsWith('.docx')).toBe(true)
    expect(Array.from(emoji)).toHaveLength(GOOGLE_FILE_DOWNLOAD_NAME_MAX)
    expect(emoji.endsWith('.txt')).toBe(true)
    expect(emoji).not.toContain('\uFFFD')
  })
})

describe('buildGoogleFileDisposition', () => {
  it('is an attachment with an ASCII name and the exact UTF-8 name', () => {
    expect(buildGoogleFileDisposition('Plan.docx')).toBe(
      'attachment; filename="Plan.docx"; filename*=UTF-8\'\'Plan.docx',
    )
  })

  it('encodes a name that is not ASCII and escapes quotes', () => {
    const value = buildGoogleFileDisposition('Звіт "Q3"\'s.docx')

    expect(value).toContain('filename="_Q3_\'s.docx"')
    expect(value).toContain(
      'filename*=UTF-8\'\'%D0%97%D0%B2%D1%96%D1%82%20%22Q3%22%27s.docx',
    )
    expect(value.split('\n')).toHaveLength(1)
  })

  it('uses a plain fallback when nothing ASCII is left', () => {
    expect(buildGoogleFileDisposition('Звіт.docx'))
      .toContain('filename="download.docx"')
  })
})
