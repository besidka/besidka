import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import { validate } from '@besidka/doc-renderer/validate'
import { XmlError, parseXml } from '../../../../packages/doc-renderer/src/validate/xml'
import { buildPackage } from '../../../fixtures/documents/malicious/builders'
import {
  docxPackage,
  paragraphXml,
} from '../../../fixtures/documents/extract/builders'

const MEBIBYTE = 1024 * 1024
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
const FOOTER = '</w:body></w:document>'

function errorCodeOf(text: string): string | null {
  try {
    for (const event of parseXml(text)) {
      expect(event).toBeDefined()
    }
  } catch (exception) {
    return exception instanceof XmlError ? exception.code : 'other'
  }

  return null
}

function documentWithOpenerAtBoundary(
  opener: string,
  cutLength: number,
  markup: string,
): Uint8Array {
  const target = MEBIBYTE - cutLength
  let body = ''
  let index = 0

  while (HEADER.length + body.length + 200 < target) {
    body += paragraphXml(`paragraph number ${index}`)
    index += 1
  }

  const startOfText = '<w:p><w:r><w:t xml:space="preserve">'
  const padding = target - HEADER.length - body.length - startOfText.length
  const text = `${startOfText}${' '.repeat(padding)}${markup}</w:t></w:r></w:p>`
  const tail = paragraphXml('tail paragraph').repeat(10)
  const xml = `${HEADER}${body}${text}${tail}${FOOTER}`

  expect(xml.indexOf(markup)).toBe(target)
  expect(xml.length).toBeGreaterThan(MEBIBYTE)
  expect(markup.startsWith(opener)).toBe(true)

  return docxPackage('', { options: { extraFiles: { 'word/document.xml': xml } } })
}

describe('parseXml: a cut opener is truncation, not a DOCTYPE', () => {
  it.each(['<!', '<!-', '<![', '<![C', '<![CDA', '<![CDATA'])(
    'reports xml_malformed for a part cut after %s',
    (opener) => {
      expect(errorCodeOf(`<a>text</a><b>${opener}`)).toBe('xml_malformed')
    },
  )

  it('still reports xml_doctype for real declarations', () => {
    expect(errorCodeOf('<!DOCTYPE a>')).toBe('xml_doctype')
    expect(errorCodeOf('<a/><!ENTITY x "y">')).toBe('xml_doctype')
    expect(errorCodeOf('<a/><!D')).toBe('xml_doctype')
    expect(errorCodeOf('<a/><![CDATAX')).toBe('xml_doctype')
  })

  it('keeps rejecting a complete part that ends in <!-', () => {
    const bytes = buildPackage('docx', { files: { 'word/other.xml': '<a/><!-' } })
    const result = validate('docx', bytes)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.code).toBe('xml_malformed')
  })
})

describe('extractOfficeText: a prefix that ends inside an opener', () => {
  it.each([
    ['<!', 2, '<!-- note -->'],
    ['<!-', 3, '<!-- note -->'],
    ['<!--', 4, '<!-- note -->'],
    ['<![CDA', 6, '<![CDATA[kept]]>'],
    ['<![CDATA', 8, '<![CDATA[kept]]>'],
  ])('reads a part longer than 1 MiB cut after %s', (opener, cut, markup) => {
    const bytes = documentWithOpenerAtBoundary(opener, cut, markup)
    const result = extractOfficeText(bytes, 'docx')

    expect(result.status).toBe('ready')
    expect(result.text).toContain('tail paragraph')

    if (markup.includes('CDATA')) {
      expect(result.text).toContain('kept')
    }
  })
})
