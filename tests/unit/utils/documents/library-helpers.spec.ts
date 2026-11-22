import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_MEDIA_TYPES,
  createEmptyDocumentFormatCounts,
  createEmptyDocumentSourceCounts,
  getDocumentDisplayTitle,
  getDocumentFormatFromMediaType,
} from '#shared/utils/documents'

describe('document library helpers', () => {
  describe('getDocumentFormatFromMediaType', () => {
    it.each(Object.entries(DOCUMENT_MEDIA_TYPES))(
      'maps the %s media type back to its format',
      (format, mediaType) => {
        expect(getDocumentFormatFromMediaType(mediaType)).toBe(format)
      },
    )

    it('returns null for other media types', () => {
      expect(getDocumentFormatFromMediaType('image/png')).toBeNull()
      expect(getDocumentFormatFromMediaType('')).toBeNull()
    })
  })

  describe('getDocumentDisplayTitle', () => {
    it('drops the format extension', () => {
      expect(getDocumentDisplayTitle('Quarterly report.pdf', 'pdf'))
        .toBe('Quarterly report')
      expect(getDocumentDisplayTitle('Deck.PPTX', 'pptx')).toBe('Deck')
    })

    it('keeps a name that has another or no extension', () => {
      expect(getDocumentDisplayTitle('Plan.pdf', 'docx')).toBe('Plan.pdf')
      expect(getDocumentDisplayTitle('Plan', 'docx')).toBe('Plan')
    })

    it('falls back to the file name when nothing is left', () => {
      expect(getDocumentDisplayTitle('.xlsx', 'xlsx')).toBe('.xlsx')
    })
  })

  it('creates zeroed counts for every format and source', () => {
    expect(createEmptyDocumentFormatCounts()).toEqual({
      pdf: 0,
      docx: 0,
      pptx: 0,
      xlsx: 0,
    })
    expect(createEmptyDocumentSourceCounts()).toEqual({ chat: 0, mcp: 0 })
  })
})
