import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import type { ExtractLimits } from '@besidka/doc-renderer/extract'
import {
  docxPackage,
  notesXml,
  paragraphXml,
  pptxPackage,
  relationshipsXml,
  runParagraphXml,
  shapeXml,
  slideXml,
  worksheetXml,
  xlsxPackage,
} from '../../../fixtures/documents/extract/builders'

const TIME_BUDGET_MS = 1000
const TEST_TIMEOUT_MS = 30_000
const MEBIBYTE = 1024 * 1024
const UNLIMITED_RATIO: Partial<ExtractLimits> = {
  zipRatioMax: Number.MAX_SAFE_INTEGER,
}
const TITLE = '<p:ph type="title"/>'
const COLUMN_CAP = 200

function cpuMilliseconds(): number {
  const { user, system } = process.threadCpuUsage()

  return (user + system) / 1000
}

function timed<Result>(work: () => Result): {
  result: Result
  elapsed: number
} {
  const startedAt = cpuMilliseconds()
  const result = work()

  return { result, elapsed: cpuMilliseconds() - startedAt }
}

function cell(text: string, properties = ''): string {
  const tcPr = properties ? `<w:tcPr>${properties}</w:tcPr>` : ''

  return `<w:tc>${tcPr}${paragraphXml(text)}</w:tc>`
}

function table(rows: string): string {
  return `<w:tbl>${rows}</w:tbl>`
}

function pptxTableCell(text: string, attributes = ''): string {
  return `<a:tc${attributes}><a:txBody>${runParagraphXml(text)}</a:txBody></a:tc>`
}

function pptxTable(rows: string): string {
  return `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

describe('extractOfficeText: hostile input stays inside the CPU and memory budget', () => {
  it('clamps a docx gridSpan allocation bomb to the column cap', () => {
    const cells = Array.from({ length: 2000 }, (_cell, index) => {
      return cell(
        index === 0 ? 'first' : '',
        '<w:gridSpan w:val="2000000000"/>',
      )
    }).join('')
    const bytes = docxPackage(table(`<w:tr>${cells}</w:tr>`))
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'docx'))

    expect(result.status).toBe('ready')
    expect(result.text).toContain('first')
    expect(result.stats.truncations).toContain('columns_limit')
    expect(result.text.split('\n')[0]?.split('|').length)
      .toBeLessThanOrEqual(COLUMN_CAP + 2)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('clamps a pptx gridSpan allocation bomb to the column cap', () => {
    const cells = Array.from({ length: 2000 }, (_cell, index) => {
      return pptxTableCell(index === 0 ? 'first' : '', ' gridSpan="2000000000"')
    }).join('')
    const slide = slideXml(pptxTable(`<a:tr>${cells}</a:tr>`))
    const bytes = pptxPackage([{ xml: slide }])
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'pptx'))

    expect(result.status).toBe('ready')
    expect(result.text).toContain('first')
    expect(result.stats.truncations).toContain('columns_limit')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('caps the columns of a docx table before building it', () => {
    const cells = Array.from({ length: 20_000 }, () => cell('x')).join('')
    const bytes = docxPackage(table(`<w:tr>${cells}</w:tr>`))
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'docx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).toContain('columns_limit')
    expect(result.text.split('\n')[0]?.split('|').length)
      .toBeLessThanOrEqual(COLUMN_CAP + 2)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('caps the rows of a docx table before building it', () => {
    const row = `<w:tr>${cell('x')}${cell('y')}</w:tr>`
    const bytes = docxPackage(table(row.repeat(10_000)))
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'docx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).toContain('rows_limit')
    expect(result.text.split('\n').length).toBeLessThanOrEqual(1002)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('caps the rows of a pptx table before building it', () => {
    const row = `<a:tr>${pptxTableCell('x')}${pptxTableCell('y')}</a:tr>`
    const slide = slideXml(pptxTable(row.repeat(10_000)))
    const bytes = pptxPackage([{ xml: slide }])
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'pptx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).toContain('rows_limit')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('stops building a pptx table once the text budget is spent', () => {
    const wide = Array.from({ length: 200 }, () => {
      return pptxTableCell('w'.repeat(1900))
    }).join('')
    const slide = slideXml(pptxTable(`<a:tr>${wide}</a:tr>`.repeat(30)))
    const bytes = pptxPackage([{ xml: slide }])
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'pptx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toContain('text_limit')
    expect(result.stats.textBytes).toBeLessThanOrEqual(MEBIBYTE)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('refuses docx paragraphs nested deeper than any real document', () => {
    const bytes = docxPackage('<w:p>'.repeat(200_000))
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'docx'))

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('ooxml_malformed')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('trims a long run of spaces in linear time in docx', () => {
    const spaces = ' '.repeat(80_000)
    const body = paragraphXml(`${spaces}x`)
      + paragraphXml(`start${spaces}\nend`)
      + paragraphXml(`${spaces}x`, '<w:pStyle w:val="Heading1"/>')
    const bytes = docxPackage(body)
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'docx'))

    expect(result.status).toBe('ready')
    expect(result.text).toContain('# ')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('trims a long run of spaces in linear time in pptx', () => {
    const spaces = ' '.repeat(80_000)
    const shapes = shapeXml([runParagraphXml(`${spaces}x`)], TITLE)
      + shapeXml([runParagraphXml(`a${spaces}\n${spaces}b`)])
    const bytes = pptxPackage([{ xml: slideXml(shapes) }])
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'pptx'))

    expect(result.status).toBe('ready')
    expect(result.text).toContain('### x')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('classifies a hostile numFmt formatCode in linear time', () => {
    const styles = '<numFmts count="1">'
      + `<numFmt numFmtId="164" formatCode="${'['.repeat(80_000)}"/>`
      + `<numFmt numFmtId="165" formatCode="${'[h'.repeat(40_000)}"/>`
      + '</numFmts><cellXfs count="2"><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>'
    const sheet = worksheetXml(
      '<row r="1"><c r="A1" s="0"><v>1.5</v></c><c r="B1" s="1"><v>2</v></c></row>',
    )
    const bytes = xlsxPackage([{ name: 'S', xml: sheet }], { stylesXml: styles })
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'xlsx'))

    expect(result.status).toBe('ready')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('sorts a pptx relationship target of 80,000 digits in linear time', () => {
    const digits = '1'.repeat(80_000)
    const bytes = pptxPackage([{ xml: slideXml('') }], {
      omitSlideList: true,
      options: {
        extraFiles: {
          'ppt/_rels/presentation.xml.rels': relationshipsXml([
            { id: 'rId1', type: 'slide', target: `slides/slide${digits}.xml` },
            { id: 'rId2', type: 'slide', target: 'slides/slide1.xml' },
          ]),
        },
      },
    })
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'pptx'))

    expect(['ready', 'empty']).toContain(result.status)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('clamps a docx list level that would allocate gigabytes of indent', () => {
    const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    const item = paragraphXml(
      'deep',
      '<w:numPr><w:ilvl w:val="200000000"/><w:numId w:val="1"/></w:numPr>',
    )
    const bytes = docxPackage(item, { numberingXml: numbering })
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'docx'))

    expect(result.status).toBe('ready')
    expect(result.text.length).toBeLessThan(100)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('reads a pptx slide listed 5,000 times once', () => {
    const slide = slideXml(shapeXml([runParagraphXml('only')], TITLE))
    const repeated = Array.from({ length: 5000 }, (_item, index) => {
      return `<p:sldId id="${256 + index}" r:id="rId10"/>`
    }).join('')
    const bytes = pptxPackage([{ xml: slide }], {
      options: {
        extraFiles: {
          'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + `<p:sldIdLst>${repeated}</p:sldIdLst></p:presentation>`,
        },
      },
    })
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'pptx'))

    expect(result.status).toBe('ready')
    expect(result.stats.slides).toBe(1)
    expect(result.stats.slidesTotal).toBe(1)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('caps a pptx at 500 slides', () => {
    const slides = Array.from({ length: 700 }, (_slide, index) => {
      return { xml: slideXml(shapeXml([runParagraphXml(`s${index}`)], TITLE)) }
    })
    const bytes = pptxPackage(slides)
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'pptx'))

    expect(result.status).toBe('ready')
    expect(result.stats.slides).toBe(500)
    expect(result.stats.slidesTotal).toBe(700)
    expect(result.stats.truncations).toContain('slides_limit')
    expect(result.truncated).toBe(true)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('parses a notes part shared by 500 slides once', () => {
    const notes = notesXml(
      shapeXml([runParagraphXml('shared note')], '<p:ph type="body"/>'),
    )
    const slides = Array.from({ length: 500 }, () => {
      return { xml: slideXml('') }
    })
    const files: Record<string, string> = { 'ppt/notesSlides/notes.xml': notes }

    slides.forEach((_slide, index) => {
      files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = relationshipsXml([
        { id: 'rId1', type: 'notesSlide', target: '../notesSlides/notes.xml' },
      ])
    })

    const bytes = pptxPackage(slides, { options: { extraFiles: files } })
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'pptx', { inflatedBytesMax: 600 * 1024 })
    })

    expect(result.status).toBe('ready')
    expect(result.stats.slides).toBe(500)
    expect(result.text).toContain('Speaker notes: shared note')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('reads a worksheet shared by 50 sheets once', () => {
    const sheet = worksheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>shared</t></is></c></row>',
    )
    const sheets = Array.from({ length: 50 }, (_sheet, index) => {
      return { name: `S${index}`, xml: sheet }
    })
    const relationships = sheets.map((_sheet, index) => {
      return {
        id: `rId${index + 1}`,
        type: 'worksheet',
        target: 'worksheets/sheet1.xml',
      }
    })
    const bytes = xlsxPackage(sheets, {
      options: {
        extraFiles: {
          'xl/_rels/workbook.xml.rels': relationshipsXml(relationships),
        },
      },
    })
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'xlsx'))

    expect(result.status).toBe('ready')
    expect(result.stats.sheets).toBe(1)
    expect(result.stats.sheetsTotal).toBe(1)
    expect(result.text.match(/## Sheet:/g)).toHaveLength(1)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('stops scanning a worksheet of millions of empty cells', () => {
    const sheet = worksheetXml(`<row r="1">${'<c/>'.repeat(600_000)}</row>`)
    const bytes = xlsxPackage([{ name: 'Empty', xml: sheet }])
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'xlsx', {
        ...UNLIMITED_RATIO,
        eventsMax: 1_000_000,
      })
    })

    expect(result.status).toBe('too_large')
    expect(result.errorCode).toBe('extract_budget_exceeded')
    expect(result.text).toBe('')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('stops scanning empty rows and cells beyond the column cap', () => {
    const rows = Array.from({ length: 1500 }, (_row, index) => {
      return `<row r="${index + 1}"/>`
    }).join('')
    const wide = `<row r="1501">${'<c r="ZZ1"/>'.repeat(100)}</row>`
    const bytes = xlsxPackage([{ name: 'S', xml: worksheetXml(rows + wide) }])
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'xlsx', { eventsMax: 500 })
    })

    expect(result.status).toBe('too_large')
    expect(result.errorCode).toBe('extract_budget_exceeded')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('answers too_large when the inflated bytes budget is spent', () => {
    const body = Array.from({ length: 2000 }, (_item, index) => {
      return paragraphXml(`Paragraph number ${index} with some text`)
    }).join('')
    const bytes = docxPackage(body)
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'docx', { inflatedBytesMax: 1024 })
    })

    expect(result.status).toBe('too_large')
    expect(result.errorCode).toBe('extract_budget_exceeded')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('inflates a part once when its prefix has to grow', () => {
    const values = Array.from({ length: 220_000 }, (_value, index) => {
      return `<c r="A${index + 1}"><v>${(index * 7_919_113) % 999_999_937}</v></c>`
    }).join('')
    const rows = `<row r="1">${values}</row>`
    const sheet = worksheetXml(rows)
    const bytes = xlsxPackage([{ name: 'Big', xml: sheet }])
    const partBytes = new TextEncoder().encode(sheet).length

    expect(partBytes).toBeGreaterThan(4 * MEBIBYTE)

    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'xlsx', {
        zipRatioMax: Number.MAX_SAFE_INTEGER,
        cellsMax: 1_000_000,
        columnsMax: 1_000_000,
        inflatedBytesMax: Math.ceil(partBytes * 1.3),
      })
    })

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).not.toContain('part_limit')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS * 3)
  }, TEST_TIMEOUT_MS)

  it('refuses a tag with thousands of distinct attributes', () => {
    const attributes = Array.from({ length: 20_000 }, (_item, index) => {
      return `a${index}="1"`
    }).join(' ')
    const body = `<w:p ${attributes}><w:r><w:t>x</w:t></w:r></w:p>`
    const bytes = docxPackage(body)
    const { result, elapsed } = timed(() => extractOfficeText(bytes, 'docx'))

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('xml_attributes')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('does not re-scan an 8 MB style name for every paragraph', () => {
    const chunk = 'abcdefghijklmnop'.repeat(32)
    let name = ''

    while (name.length < 8_000_000) {
      name += `${chunk}${name.length % 997}`
    }

    const styles = `<w:style w:type="paragraph" w:styleId="S"><w:name w:val="${name}"/><w:basedOn w:val="S"/></w:style>`
    const body = Array.from({ length: 5000 }, () => {
      return paragraphXml('x', '<w:pStyle w:val="S"/>')
    }).join('')
    const bytes = docxPackage(body, { stylesXml: styles })
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'docx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('keeps long ids and numbering keys short', () => {
    const longId = 'n'.repeat(2_000_000)
    const numbering = `<w:abstractNum w:abstractNumId="${longId}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="${longId}"><w:abstractNumId w:val="${longId}"/></w:num>`
    const body = Array.from({ length: 3000 }, () => {
      return paragraphXml(
        'item',
        `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${'n'.repeat(70)}"/></w:numPr>`,
      )
    }).join('')
    const bytes = docxPackage(body, { numberingXml: numbering })
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'docx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.text).toContain('1. item')
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('reads no more than 1,000 relationships from a slide rels part', () => {
    const junk = Array.from({ length: 1500 }, (_item, index) => {
      return { id: `j${index}`, type: 'hyperlink', target: `t${index}` }
    })
    const notesRelationship = {
      id: 'n1',
      type: 'notesSlide',
      target: '../notesSlides/notes1.xml',
    }
    const notes = notesXml(
      shapeXml([runParagraphXml('late note')], '<p:ph type="body"/>'),
    )
    const slide = { xml: slideXml(shapeXml([runParagraphXml('s')], TITLE)) }
    const bytes = pptxPackage([slide, slide], {
      options: {
        extraFiles: {
          'ppt/notesSlides/notes1.xml': notes,
          'ppt/slides/_rels/slide1.xml.rels': relationshipsXml([
            notesRelationship,
            ...junk,
          ]),
          'ppt/slides/_rels/slide2.xml.rels': relationshipsXml([
            ...junk,
            notesRelationship,
          ]),
        },
      },
    })
    const result = extractOfficeText(bytes, 'pptx')

    expect(result.status).toBe('ready')
    expect(result.text.match(/Speaker notes: late note/g)).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  it('streams the rels parts of many slides without holding them', () => {
    const items = Array.from({ length: 4999 }, (_item, index) => {
      return `<Relationship Id="${index}" Type="h" Target="t${index}"/>`
    }).join('')
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`
    const slides = Array.from({ length: 120 }, (_slide, index) => {
      return { xml: slideXml(shapeXml([runParagraphXml(`s${index}`)], TITLE)) }
    })
    const extraFiles: Record<string, string> = {}

    slides.forEach((_slide, index) => {
      extraFiles[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = rels
    })

    const bytes = pptxPackage(slides, { options: { extraFiles } })
    const { result, elapsed } = timed(() => {
      return extractOfficeText(bytes, 'pptx', UNLIMITED_RATIO)
    })

    expect(result.status).toBe('ready')
    expect(result.stats.slides).toBe(120)
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS)
  }, TEST_TIMEOUT_MS)

  it('fails closed when [Content_Types].xml cannot be read in full', () => {
    const bytes = docxPackage(paragraphXml('x'))
    const { result } = timed(() => {
      return extractOfficeText(bytes, 'docx', { contentTypesBytesMax: 16 })
    })

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('ooxml_malformed')
  }, TEST_TIMEOUT_MS)
})
