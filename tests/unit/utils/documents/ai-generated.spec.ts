import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_FORMAT_LIBRARY_LABELS,
  isDocumentAiGenerated,
} from '../../../../shared/utils/documents'

describe('isDocumentAiGenerated', () => {
  it.each([
    ['chat', true, true],
    ['chat', false, false],
    ['chat', null, true],
    ['mcp', true, true],
    ['mcp', false, false],
    ['mcp', null, false],
    ['research', null, true],
    ['schedule', null, true],
  ] as const)(
    'reads %s with a stored flag of %s as %s',
    (createdVia, aiGenerated, expected) => {
      expect(isDocumentAiGenerated({ createdVia, aiGenerated }))
        .toBe(expected)
    },
  )
})

describe('DOCUMENT_FORMAT_LIBRARY_LABELS', () => {
  it('names the formats by the product, not the file extension', () => {
    expect(DOCUMENT_FORMAT_LIBRARY_LABELS).toEqual({
      pdf: 'PDF',
      docx: 'Word',
      pptx: 'PowerPoint',
      xlsx: 'Excel',
    })
  })
})
