import { describe, expect, it } from 'vitest'
import {
  formatDocumentCell,
  getDocumentMetaLabel,
  getDocumentStatsLabel,
  getMessageModelId,
  readSharedDocumentFile,
} from '../../../app/utils/document-ui'

const stats = {
  pages: 3,
  slides: 12,
  sheets: 2,
  cells: 40,
  images: 0,
}

describe('document ui helpers', () => {
  it('words the count per format with singular and plural forms', () => {
    expect(getDocumentStatsLabel('pdf', stats)).toBe('3 pages')
    expect(getDocumentStatsLabel('docx', { ...stats, pages: 1 }))
      .toBe('1 page')
    expect(getDocumentStatsLabel('pptx', stats)).toBe('12 slides')
    expect(getDocumentStatsLabel('xlsx', stats)).toBe('2 sheets')
    expect(getDocumentStatsLabel('xlsx', { ...stats, sheets: null })).toBe('')
    expect(getDocumentStatsLabel('docx', null)).toBe('')
  })

  it('joins the count and the file size', () => {
    expect(getDocumentMetaLabel('docx', stats, 2048)).toBe('3 pages · 2.0 KB')
    expect(getDocumentMetaLabel('docx', stats, 0)).toBe('3 pages')
    expect(getDocumentMetaLabel('docx', null, undefined)).toBe('')
  })

  it('reads the model id from message usage metadata', () => {
    expect(getMessageModelId({ metadata: { usage: { model: 'gpt-5' } } }))
      .toBe('gpt-5')
    expect(getMessageModelId({ metadata: { usage: {} } })).toBeUndefined()
    expect(getMessageModelId({ metadata: 'x' })).toBeUndefined()
    expect(getMessageModelId({})).toBeUndefined()
  })

  it('formats every spreadsheet cell shape', () => {
    expect(formatDocumentCell('text')).toBe('text')
    expect(formatDocumentCell(7)).toBe('7')
    expect(formatDocumentCell(false)).toBe('false')
    expect(formatDocumentCell(null)).toBe('')
    expect(formatDocumentCell(undefined)).toBe('')
    expect(formatDocumentCell({ date: '2026-11-08' })).toBe('2026-11-08')
    expect(formatDocumentCell({ formula: 'A1+1', cached: 5 })).toBe('5')
    expect(formatDocumentCell({ formula: 'A1+1' })).toBe('=A1+1')
  })

  it('accepts only a local shared file url', () => {
    const file = { url: '/shared/x/file', name: 'a.docx', size: 5, type: 't' }

    expect(readSharedDocumentFile({ data: { file } })).toEqual(file)
    expect(readSharedDocumentFile({ data: { file: { ...file, url: '//evil' } } }))
      .toBeNull()
    expect(readSharedDocumentFile({ data: {} })).toBeNull()
    expect(readSharedDocumentFile(null)).toBeNull()
  })
})
