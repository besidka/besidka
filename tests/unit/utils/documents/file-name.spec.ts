import { describe, expect, it } from 'vitest'
import { getDocumentFileName } from '#shared/utils/documents'

describe('getDocumentFileName', () => {
  it('appends the format extension to a plain title', () => {
    expect(getDocumentFileName('Quarterly report', 'pdf'))
      .toBe('Quarterly report.pdf')
  })

  it('replaces path and shell characters and collapses whitespace', () => {
    expect(getDocumentFileName('a/b\\c:d*e?f"g<h>i|j', 'docx'))
      .toBe('a b c d e f g h i j.docx')
  })

  it('removes control characters and leading dots', () => {
    expect(getDocumentFileName('..\u0000hidden\u007F\ttitle', 'pptx'))
      .toBe('hiddentitle.pptx')
  })

  it('falls back to "document" for an empty or fully stripped title', () => {
    expect(getDocumentFileName('', 'xlsx')).toBe('document.xlsx')
    expect(getDocumentFileName('‮​/', 'xlsx'))
      .toBe('document.xlsx')
  })

  it('strips bidi controls so a name cannot be visually reordered', () => {
    const reversed = 'invoice‮fdp.exe'

    expect(getDocumentFileName(reversed, 'pdf')).toBe('invoicefdp.exe.pdf')
    expect(getDocumentFileName('a⁦b⁧c⁨d⁩e‎f‏g؜h', 'pdf'))
      .toBe('abcdefgh.pdf')
  })

  it('strips zero-width and other format characters', () => {
    expect(getDocumentFileName('Re​port‍⁠﻿­', 'pdf'))
      .toBe('Report.pdf')
  })

  it('strips Unicode tag characters', () => {
    const tags = String.fromCodePoint(0xE0001, 0xE0049, 0xE0067, 0xE007F)

    expect(getDocumentFileName(`Plan${tags} v2`, 'docx'))
      .toBe('Plan v2.docx')
  })

  it('keeps letters of any script', () => {
    expect(getDocumentFileName('Звіт Müller 東京', 'pdf'))
      .toBe('Звіт Müller 東京.pdf')
  })

  it('caps the name at 120 characters before the extension', () => {
    const name = getDocumentFileName('x'.repeat(300), 'pdf')

    expect(name).toBe(`${'x'.repeat(120)}.pdf`)
  })
})
