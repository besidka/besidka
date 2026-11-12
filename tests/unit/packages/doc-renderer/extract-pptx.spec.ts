import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import {
  SAMPLE_SPECS,
  notesXml,
  pptxPackage,
  renderSpec,
  runParagraphXml,
  shapeXml,
  slideXml,
} from '../../../fixtures/documents/extract/builders'

const TITLE = '<p:ph type="title"/>'
const BODY = '<p:ph type="body" idx="1"/>'
const BULLET = '<a:pPr lvl="1"><a:buChar char="-"/></a:pPr>'
const NO_BULLET = '<a:pPr><a:buNone/></a:pPr>'

function readyText(bytes: Uint8Array): string {
  const result = extractOfficeText(bytes, 'pptx')

  expect(result.status).toBe('ready')

  return result.text
}

describe('extractOfficeText: pptx from the renderer', () => {
  it('writes one section per slide with titles, bullets and notes', async () => {
    const bytes = await renderSpec(SAMPLE_SPECS.pptx)
    const result = extractOfficeText(bytes, 'pptx')

    expect(result.status).toBe('ready')
    expect(result.text).toBe([
      '## Slide 1',
      '',
      '### Launch plan',
      '',
      'Autumn 2026',
      '',
      '## Slide 2',
      '',
      '### Goals',
      '',
      '- Ship the beta',
      '- Hire two people',
      '',
      'Speaker notes: Mention the budget.',
    ].join('\n'))
    expect(result.stats.slides).toBe(2)
    expect(result.stats.slidesTotal).toBe(2)
  })
})

describe('extractOfficeText: pptx structure', () => {
  it('follows the slide list, not the file numbering', () => {
    const slides = ['first file', 'second file', 'third file'].map((text) => {
      return { xml: slideXml(shapeXml([runParagraphXml(text)])) }
    })

    expect(readyText(pptxPackage(slides, { listedOrder: [3, 1, 2] }))).toBe([
      '## Slide 1',
      '',
      'third file',
      '',
      '## Slide 2',
      '',
      'first file',
      '',
      '## Slide 3',
      '',
      'second file',
    ].join('\n'))
  })

  it('reads the relationship id when r:id comes before id', () => {
    const slides = ['alpha', 'beta'].map((text) => {
      return { xml: slideXml(shapeXml([runParagraphXml(text)])) }
    })
    const bytes = pptxPackage(slides, {
      listedOrder: [2, 1],
      swapIdAttributes: true,
    })

    expect(readyText(bytes)).toBe(
      '## Slide 1\n\nbeta\n\n## Slide 2\n\nalpha',
    )
  })

  it('falls back to file order when there is no slide list', () => {
    const slides = ['one', 'two'].map((text) => {
      return { xml: slideXml(shapeXml([runParagraphXml(text)])) }
    })

    expect(readyText(pptxPackage(slides, { omitSlideList: true }))).toBe(
      '## Slide 1\n\none\n\n## Slide 2\n\ntwo',
    )
  })

  it('takes only the notes body, not the slide number placeholder', () => {
    const notes = notesXml(
      shapeXml([runParagraphXml('slide image')], '<p:ph type="sldImg"/>')
      + shapeXml(
        [runParagraphXml('First note'), runParagraphXml('Second note')],
        '<p:ph type="body" idx="1"/>',
      )
      + shapeXml(
        ['<a:p><a:fld type="slidenum"><a:t>7</a:t></a:fld></a:p>'],
        '<p:ph type="sldNum" idx="10"/>',
      ),
    )
    const slide = slideXml(shapeXml([runParagraphXml('Body text')]))

    expect(readyText(pptxPackage([{ xml: slide, notesXml: notes }]))).toBe(
      '## Slide 1\n\nBody text\n\nSpeaker notes: First note\nSecond note',
    )
  })

  it('bullets body placeholders and explicit bullets, not plain text boxes', () => {
    const slide = slideXml(
      shapeXml([runParagraphXml('Heading line')], TITLE)
      + shapeXml(
        [runParagraphXml('Default bullet'), runParagraphXml('Plain', NO_BULLET)],
        BODY,
      )
      + shapeXml([
        runParagraphXml('Text box line'),
        runParagraphXml('Nested', BULLET),
      ])
      + shapeXml([runParagraphXml('Date text')], '<p:ph type="dt"/>')
      + shapeXml([runParagraphXml('Footer text')], '<p:ph type="ftr"/>'),
    )

    expect(readyText(pptxPackage([{ xml: slide }]))).toBe([
      '## Slide 1',
      '',
      '### Heading line',
      '',
      '- Default bullet',
      '',
      'Plain',
      '',
      'Text box line',
      '',
      '  - Nested',
    ].join('\n'))
  })

  it('writes tables as Markdown and joins runs and line breaks', () => {
    const cell = (text: string, attributes = '') => {
      return `<a:tc${attributes}><a:txBody>${runParagraphXml(text)}</a:txBody></a:tc>`
    }
    const table = '<p:graphicFrame><a:graphic><a:graphicData><a:tbl>'
      + `<a:tr>${cell('Name')}${cell('Qty')}</a:tr>`
      + `<a:tr>${cell('Pens')}${cell('4')}</a:tr>`
      + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
    const split = shapeXml([
      '<a:p><a:r><a:t>Split </a:t></a:r><a:r><a:t>run</a:t></a:r>'
      + '<a:br/><a:r><a:t>next</a:t></a:r></a:p>',
    ])

    expect(readyText(pptxPackage([{ xml: slideXml(split + table) }]))).toBe([
      '## Slide 1',
      '',
      'Split run\nnext',
      '',
      '| Name | Qty |',
      '| --- | --- |',
      '| Pens | 4 |',
    ].join('\n'))
  })

  it('skips the fallback branch of alternate content', () => {
    const slide = slideXml(
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
      + `<mc:Choice>${shapeXml([runParagraphXml('modern')])}</mc:Choice>`
      + `<mc:Fallback>${shapeXml([runParagraphXml('legacy copy')])}</mc:Fallback>`
      + '</mc:AlternateContent>',
    )

    expect(readyText(pptxPackage([{ xml: slide }]))).toBe(
      '## Slide 1\n\nmodern',
    )
  })

  it('reports a deck without text as empty', () => {
    const result = extractOfficeText(
      pptxPackage([{ xml: slideXml('') }, { xml: slideXml('') }]),
      'pptx',
    )

    expect(result.status).toBe('empty')
    expect(result.text).toBe('')
  })

  it('cuts a long deck at the text limit', () => {
    const slides = Array.from({ length: 300 }, (_value, index) => {
      return {
        xml: slideXml(
          shapeXml([runParagraphXml(`Слайд ${index + 1}`)], TITLE)
          + shapeXml([runParagraphXml('Filler line '.repeat(30))], BODY),
        ),
      }
    })
    const result = extractOfficeText(pptxPackage(slides), 'pptx', {
      textBytesMax: 8000,
    })

    expect(result.truncated).toBe(true)
    expect(result.stats.slidesTotal).toBe(300)
    expect(result.stats.slides).toBeLessThan(300)
    expect(new TextEncoder().encode(result.text).length)
      .toBeLessThanOrEqual(8000)
    expect(result.text).toMatch(/\[Truncated: .+\]$/)
  })
})
