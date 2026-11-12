import { describe, expect, it } from 'vitest'
import {
  EXTRACT_VERSION,
} from '@besidka/doc-renderer/extract'
import {
  OFFICE_MEDIA_TYPES,
  OFFICE_TEXT_VERSION,
  getAllowedFileFormats,
  getOfficeExtensionKind,
  getOfficeFormatByFileName,
  getOfficeFormatByMediaType,
  getOfficeTextStorageKey,
  isLegacyOfficeMediaType,
  isOfficeMediaType,
  isOfficeStorageKey,
  withDerivedKeys,
} from '../../../shared/utils/office-files'
import { DOCUMENT_MEDIA_TYPES } from '../../../shared/utils/documents'

describe('office files', () => {
  it('keeps the stored text version in step with the extractor', () => {
    expect(OFFICE_TEXT_VERSION).toBe(EXTRACT_VERSION)
  })

  it('uses the same media types as generated documents', () => {
    expect(OFFICE_MEDIA_TYPES.docx).toBe(DOCUMENT_MEDIA_TYPES.docx)
    expect(OFFICE_MEDIA_TYPES.xlsx).toBe(DOCUMENT_MEDIA_TYPES.xlsx)
    expect(OFFICE_MEDIA_TYPES.pptx).toBe(DOCUMENT_MEDIA_TYPES.pptx)
  })

  it('classifies extensions', () => {
    expect(getOfficeExtensionKind('Report.DOCX')).toBe('office')
    expect(getOfficeExtensionKind('data.xlsx')).toBe('office')
    expect(getOfficeExtensionKind('deck.pptx')).toBe('office')
    expect(getOfficeExtensionKind('old.doc')).toBe('legacy')
    expect(getOfficeExtensionKind('old.xls')).toBe('legacy')
    expect(getOfficeExtensionKind('old.ppt')).toBe('legacy')
    expect(getOfficeExtensionKind('macro.docm')).toBe('macro')
    expect(getOfficeExtensionKind('macro.xlsm')).toBe('macro')
    expect(getOfficeExtensionKind('macro.pptm')).toBe('macro')
    expect(getOfficeExtensionKind('notes.txt')).toBeNull()
    expect(getOfficeExtensionKind('docx')).toBeNull()
    expect(getOfficeFormatByFileName('a.pptx')).toBe('pptx')
    expect(getOfficeFormatByFileName('a.pptm')).toBeNull()
  })

  it('classifies media types', () => {
    expect(isOfficeMediaType(OFFICE_MEDIA_TYPES.docx)).toBe(true)
    expect(isOfficeMediaType('application/pdf')).toBe(false)
    expect(getOfficeFormatByMediaType(OFFICE_MEDIA_TYPES.xlsx)).toBe('xlsx')
    expect(isLegacyOfficeMediaType('application/msword')).toBe(true)
    expect(isLegacyOfficeMediaType(OFFICE_MEDIA_TYPES.docx)).toBe(false)
  })

  it('adds the Office types to the base list only with the flag', () => {
    const base = ['image/png', 'application/pdf']

    expect(getAllowedFileFormats(base, { office: false })).toEqual(base)
    expect(getAllowedFileFormats(base, { office: true })).toEqual([
      ...base,
      OFFICE_MEDIA_TYPES.docx,
      OFFICE_MEDIA_TYPES.xlsx,
      OFFICE_MEDIA_TYPES.pptx,
    ])
  })

  describe('withDerivedKeys', () => {
    it('adds a sidecar key for each Office key and nothing else', () => {
      expect(withDerivedKeys([
        'a.docx',
        'b.png',
        'c.xlsx',
        'd.pptx',
        'e.txt',
      ])).toEqual([
        'a.docx',
        'b.png',
        'c.xlsx',
        'd.pptx',
        'e.txt',
        'a.docx.text.md',
        'c.xlsx.text.md',
        'd.pptx.text.md',
      ])
    })

    it('leaves a list without Office keys unchanged', () => {
      expect(withDerivedKeys(['a.png', 'b.pdf'])).toEqual(['a.png', 'b.pdf'])
      expect(withDerivedKeys([])).toEqual([])
    })

    it('does not treat a sidecar key as a file key', () => {
      expect(isOfficeStorageKey(getOfficeTextStorageKey('a.docx'))).toBe(false)
    })
  })
})
