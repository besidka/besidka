import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import {
  SAMPLE_SPECS,
  docxPackage,
  paragraphXml,
  renderSpec,
} from '../../../fixtures/documents/extract/builders'

const HEADING_STYLES = `
  <w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>
    <w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr>
  </w:style>
`
const NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="8"><w:abstractNumId w:val="1"/></w:num>
`

function listItem(text: string, numId: string, level: number): string {
  return paragraphXml(
    text,
    `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
  )
}

function readyText(bytes: Uint8Array): string {
  const result = extractOfficeText(bytes, 'docx')

  expect(result.status).toBe('ready')

  return result.text
}

describe('extractOfficeText: docx from the renderer', () => {
  it('writes headings, links, nested lists and a Markdown table', async () => {
    const bytes = await renderSpec(SAMPLE_SPECS.docx)
    const result = extractOfficeText(bytes, 'docx')

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(false)
    expect(result.errorCode).toBeUndefined()
    expect(result.text).toContain('# Quarterly report')
    expect(result.text).toContain('## Highlights')
    expect(result.text).toContain(
      'Revenue grew. See the dashboard for details.',
    )
    expect(result.text).toContain('- First point\n  - Nested point')
    expect(result.text).toContain('- Second point')
    expect(result.text).toContain('1. Step one\n2. Step two')
    expect(result.text).toContain(
      '| Region | Revenue |\n| --- | --- |\n| Київ | 120 |\n'
      + '| Lviv \\| West | 90 |',
    )
    expect(result.stats.tables).toBe(1)
    expect(result.stats.paragraphs).toBeGreaterThan(5)
    expect(result.stats.truncations).toEqual([])
  })
})

describe('extractOfficeText: docx structure', () => {
  it('reads heading levels from style names, not style ids', () => {
    const bytes = docxPackage(
      paragraphXml('Titel text', '<w:pStyle w:val="Titel"/>')
      + paragraphXml('Kapitel', '<w:pStyle w:val="Titre1"/>')
      + paragraphXml('Abschnitt', '<w:pStyle w:val="Titre2"/>')
      + paragraphXml('Body'),
      { stylesXml: HEADING_STYLES },
    )

    expect(readyText(bytes)).toBe(
      '# Titel text\n\n# Kapitel\n\n## Abschnitt\n\nBody',
    )
  })

  it('falls back to Heading1 style ids when there is no styles part', () => {
    const bytes = docxPackage(
      paragraphXml('Top', '<w:pStyle w:val="Heading1"/>')
      + paragraphXml('Sub', '<w:pStyle w:val="Heading3"/>'),
    )

    expect(readyText(bytes)).toBe('# Top\n\n### Sub')
  })

  it('writes bullets, numbered levels and style based lists', () => {
    const bytes = docxPackage(
      listItem('Alpha', '7', 0)
      + listItem('Beta', '7', 1)
      + paragraphXml('Between')
      + listItem('One', '8', 0)
      + listItem('Sub a', '8', 1)
      + listItem('Sub b', '8', 1)
      + listItem('Two', '8', 0)
      + listItem('Not a list', '0', 0)
      + paragraphXml('Styled bullet', '<w:pStyle w:val="ListBullet"/>'),
      { stylesXml: HEADING_STYLES, numberingXml: NUMBERING },
    )

    expect(readyText(bytes)).toBe([
      '- Alpha',
      '  - Beta',
      '',
      'Between',
      '',
      '3. One',
      '  1. Sub a',
      '  2. Sub b',
      '4. Two',
      '',
      'Not a list',
      '',
      '- Styled bullet',
    ].join('\n'))
  })

  it('keeps hyperlink text, tabs and line breaks and drops field codes', () => {
    const body = '<w:p>'
      + '<w:r><w:t>Visit </w:t></w:r>'
      + '<w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<w:r><w:t>our site</w:t></w:r></w:hyperlink>'
      + '<w:r><w:tab/><w:t>now</w:t><w:br/><w:t>Next line</w:t></w:r>'
      + '<w:r><w:instrText> HYPERLINK "https://secret.example" </w:instrText></w:r>'
      + '</w:p>'

    expect(readyText(docxPackage(body))).toBe('Visit our site now\nNext line')
  })

  it('skips deleted text, drawings and the fallback of alternate content', () => {
    const body = '<w:p>'
      + '<w:r><w:t>Kept </w:t></w:r>'
      + '<w:del><w:r><w:delText>removed</w:delText></w:r></w:del>'
      + '<w:ins><w:r><w:t>inserted</w:t></w:r></w:ins>'
      + '<w:r><w:drawing><w:p><w:r><w:t>text box words</w:t></w:r></w:p></w:drawing></w:r>'
      + '<mc:AlternateContent><mc:Choice><w:r><w:t> chosen</w:t></w:r></mc:Choice>'
      + '<mc:Fallback><w:r><w:t> duplicate</w:t></w:r></mc:Fallback>'
      + '</mc:AlternateContent>'
      + '</w:p>'

    expect(readyText(docxPackage(body))).toBe('Kept inserted chosen')
  })

  it('writes merged cells as empty cells and flattens nested tables', () => {
    const cell = (text: string, properties = '') => {
      return `<w:tc>${properties ? `<w:tcPr>${properties}</w:tcPr>` : ''}`
        + `${paragraphXml(text)}</w:tc>`
    }
    const nested = `<w:tbl><w:tr>${cell('inner a')}${cell('inner b')}</w:tr></w:tbl>`
    const table = '<w:tbl>'
      + `<w:tr>${cell('Wide header', '<w:gridSpan w:val="2"/>')}${cell('Last')}</w:tr>`
      + `<w:tr>${cell('Top', '<w:vMerge w:val="restart"/>')}${cell('B')}${cell('C')}</w:tr>`
      + `<w:tr>${cell('hidden', '<w:vMerge/>')}${cell('E')}`
      + `<w:tc>${paragraphXml('F')}${nested}</w:tc></w:tr>`
      + '</w:tbl>'

    expect(readyText(docxPackage(table))).toBe([
      '| Wide header |  | Last |',
      '| --- | --- | --- |',
      '| Top | B | C |',
      '|  | E | F inner a inner b |',
    ].join('\n'))
  })

  it('reports an empty document as empty', () => {
    const result = extractOfficeText(
      docxPackage(
        '<w:p/>' + paragraphXml('   ') + '<w:p><w:r><w:t></w:t></w:r></w:p>',
      ),
      'docx',
    )

    expect(result.status).toBe('empty')
    expect(result.text).toBe('')
    expect(result.truncated).toBe(false)
  })

  it('cuts the text at the limit on a character boundary', () => {
    const paragraph = 'Привіт світе 😀 '.repeat(40)
    const body = Array.from({ length: 200 }, () => paragraphXml(paragraph))
      .join('')
    const result = extractOfficeText(docxPackage(body), 'docx', {
      textBytesMax: 4096,
    })
    const encoded = new TextEncoder().encode(result.text)

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toContain('text_limit')
    expect(result.text).toMatch(/\[Truncated: .+\]$/)
    expect(encoded.length).toBeLessThanOrEqual(4096)
    expect(result.stats.textBytes).toBe(encoded.length)
    expect(new TextDecoder().decode(encoded)).toBe(result.text)
    expect(result.text).not.toContain('�')
  })

  it('stops reading a large document once the text limit is reached', () => {
    const body = Array.from({ length: 60000 }, (_value, index) => {
      return paragraphXml(`Paragraph number ${index} with some filler text.`)
    }).join('')
    const result = extractOfficeText(docxPackage(body), 'docx', {
      textBytesMax: 2000,
    })

    expect(result.truncated).toBe(true)
    expect(result.text).toContain('Paragraph number 0 ')
    expect(result.text).not.toContain('Paragraph number 59999')
  })

  it('keeps a partial result when a part exceeds the part cap', () => {
    const body = Array.from({ length: 4000 }, (_value, index) => {
      return paragraphXml(`Рядок ${index}`)
    }).join('')
    const result = extractOfficeText(docxPackage(body), 'docx', {
      partBytesMax: 20000,
    })

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toContain('part_limit')
    expect(result.text).toContain('Рядок 0')
    expect(result.text).not.toContain('Рядок 3999')
    expect(result.text).not.toContain('�')
  })
})
