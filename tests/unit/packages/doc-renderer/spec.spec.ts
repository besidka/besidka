import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_SPEC_VERSION,
  MAX_REPORTED_ISSUES,
  SUPPORTED_SPEC_VERSIONS,
  estimatePages,
  parseDocumentSpec,
  summarizeSpec,
} from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import { loadReferenceSpec } from '~~/tests/setup/helpers/documents'

function docx(blocks: unknown[], extra: object = {}) {
  return { specVersion: 1, format: 'docx', title: 'Title', blocks, ...extra }
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', runs: [{ text }] }
}

function sheetSpec(sheets: unknown[]) {
  return { specVersion: 1, format: 'xlsx', title: 'Book', sheets }
}

function sheet(rows: unknown[][], name = 'Data') {
  return {
    name,
    columns: [{ header: 'A', type: 'string' }, { header: 'B', type: 'number' }],
    rows,
  }
}

function issuePaths(input: unknown): string[] {
  const result = parseDocumentSpec(input)

  if (result.ok) {
    return []
  }

  return result.issues.map(issue => issue.path)
}

describe('parseDocumentSpec', () => {
  it('exposes the spec version constants', () => {
    expect(DOCUMENT_SPEC_VERSION).toBe(1)
    expect(SUPPORTED_SPEC_VERSIONS).toEqual([1])
  })

  it('accepts every reference spec', () => {
    for (const name of ['report', 'report-pdf', 'deck', 'workbook', 'showcase'] as const) {
      const result = parseDocumentSpec(loadReferenceSpec(name))

      expect(result.ok, name).toBe(true)
    }
  })

  it('rejects an unsupported specVersion with its path', () => {
    expect(issuePaths({ ...docx([paragraph()]), specVersion: 2 }))
      .toEqual(['$.specVersion'])
  })

  it('rejects unknown keys so models cannot smuggle fields', () => {
    expect(issuePaths(docx([{ ...paragraph(), onclick: 'x' }])).length)
      .toBeGreaterThan(0)
  })

  it('reports stable JSON paths for nested violations', () => {
    const paths = issuePaths(docx([
      paragraph(),
      { type: 'paragraph', runs: [{ text: 'ok' }, { text: '' }] },
    ]))

    expect(paths.some(path => path.startsWith('$.blocks[1]'))).toBe(true)
  })

  it('caps the issue list at ten entries', () => {
    const blocks = Array.from({ length: 30 }, () => {
      return { type: 'heading', level: 9, text: 'x' }
    })
    const result = parseDocumentSpec(docx(blocks))

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES)
    }
  })

  it('enforces the title, text and run bounds', () => {
    expect(parseDocumentSpec(docx([paragraph()], { title: '' })).ok).toBe(false)
    expect(parseDocumentSpec(docx([paragraph()], { title: 'x'.repeat(201) })).ok)
      .toBe(false)
    expect(parseDocumentSpec(docx([paragraph('x'.repeat(4000))])).ok).toBe(true)
    expect(parseDocumentSpec(docx([paragraph('x'.repeat(4001))])).ok).toBe(false)
    expect(parseDocumentSpec(docx([{
      type: 'paragraph',
      runs: Array.from({ length: 201 }, () => ({ text: 'a' })),
    }])).ok).toBe(false)
    expect(parseDocumentSpec(docx([])).ok).toBe(false)
  })

  it('enforces BCP-47 language tags', () => {
    expect(parseDocumentSpec(docx([paragraph()], { language: 'uk-UA' })).ok)
      .toBe(true)
    expect(parseDocumentSpec(docx([paragraph()], { language: 'not a tag' })).ok)
      .toBe(false)
  })

  describe('link schemes', () => {
    function withLink(href: string) {
      return docx([{
        type: 'paragraph',
        runs: [{ text: 'link', link: { href } }],
      }])
    }

    it('allows https and mailto only', () => {
      expect(parseDocumentSpec(withLink('https://example.com/a?b=1')).ok)
        .toBe(true)
      expect(parseDocumentSpec(withLink('HTTPS://example.com')).ok).toBe(true)
      expect(parseDocumentSpec(withLink('mailto:a@example.com')).ok).toBe(true)
    })

    it.each([
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      ' https://example.com',
      '\thttps://example.com',
      'https://example.com/\u0000',
      '//example.com',
      'example.com',
      '',
    ])('rejects %j', (href) => {
      const paths = issuePaths(withLink(href))

      expect(paths).toContain('$.blocks[0].runs[0].link.href')
    })
  })

  describe('lists', () => {
    const leaf = { runs: [{ text: 'leaf' }] }

    it('allows three levels and rejects a fourth with a path', () => {
      const three = {
        type: 'list',
        ordered: false,
        items: [{
          runs: [{ text: 'a' }],
          children: [{ runs: [{ text: 'b' }], children: [leaf] }],
        }],
      }
      const four = {
        type: 'list',
        ordered: false,
        items: [{
          runs: [{ text: 'a' }],
          children: [{
            runs: [{ text: 'b' }],
            children: [{ runs: [{ text: 'c' }], children: [leaf] }],
          }],
        }],
      }

      expect(parseDocumentSpec(docx([three])).ok).toBe(true)
      expect(parseDocumentSpec(docx([four])).ok).toBe(false)
    })

    it('limits a list to 500 items', () => {
      const items = (count: number) => {
        return Array.from({ length: count }, () => ({ runs: [{ text: 'i' }] }))
      }

      expect(parseDocumentSpec(docx([
        { type: 'list', ordered: true, items: items(500) },
      ])).ok).toBe(true)
      expect(parseDocumentSpec(docx([
        { type: 'list', ordered: true, items: items(501) },
      ])).ok).toBe(false)
    })
  })

  describe('tables', () => {
    function table(columns: number, rows: number, cells = columns) {
      return {
        type: 'table',
        header: true,
        columns: Array.from({ length: columns }, () => ({ text: 'c' })),
        rows: Array.from({ length: rows }, () => {
          return Array.from({ length: cells }, () => [{ text: 'x' }])
        }),
      }
    }

    it('enforces 20 columns and 500 rows', () => {
      expect(parseDocumentSpec(docx([table(20, 500)])).ok).toBe(true)
      expect(parseDocumentSpec(docx([table(21, 1)])).ok).toBe(false)
      expect(parseDocumentSpec(docx([table(2, 501)])).ok).toBe(false)
    })

    it('reports the row whose cell count differs from the columns', () => {
      expect(issuePaths(docx([table(3, 2, 2)]))).toContain('$.blocks[0].rows[0]')
    })
  })

  describe('images and blocks', () => {
    it('bounds widthPercent and requires alt text', () => {
      const image = { type: 'image', fileId: 'f1', alt: 'alt', widthPercent: 50 }

      expect(parseDocumentSpec(docx([image])).ok).toBe(true)
      expect(parseDocumentSpec(docx([{ ...image, widthPercent: 9 }])).ok)
        .toBe(false)
      expect(parseDocumentSpec(docx([{ ...image, widthPercent: 101 }])).ok)
        .toBe(false)
      expect(parseDocumentSpec(docx([{ ...image, alt: '' }])).ok).toBe(false)
    })

    it('limits a document to 20 images', () => {
      const image = { type: 'image', fileId: 'f1', alt: 'alt', widthPercent: 20 }

      const images = (count: number) => {
        return Array.from({ length: count }, () => image)
      }

      expect(parseDocumentSpec(docx(images(20))).ok).toBe(true)
      expect(parseDocumentSpec(docx(images(21))).ok).toBe(false)
    })

    it('limits code text to 20000 characters', () => {
      expect(parseDocumentSpec(docx([{ type: 'code', text: 'x'.repeat(20000) }])).ok)
        .toBe(true)
      expect(parseDocumentSpec(docx([{ type: 'code', text: 'x'.repeat(20001) }])).ok)
        .toBe(false)
    })
  })

  describe('global bounds', () => {
    it('rejects a spec whose serialized form exceeds 200,000 characters', () => {
      const blocks = Array.from({ length: 60 }, () => paragraph('x'.repeat(3990)))
      const result = parseDocumentSpec(docx(blocks))

      expect(result.ok).toBe(false)

      if (!result.ok) {
        expect(result.issues[0]?.path).toBe('$')
      }
    })

    it('rejects values that are not JSON-serializable', () => {
      const cyclic: Record<string, unknown> = {}

      cyclic.self = cyclic

      expect(issuePaths(cyclic)).toEqual(['$'])
    })

    it('rejects an estimate above 200 pages', () => {
      const breaks = Array.from({ length: 200 }, () => ({ type: 'pageBreak' }))

      expect(parseDocumentSpec(docx([paragraph(), ...breaks.slice(0, 199)])).ok)
        .toBe(true)
      expect(issuePaths(docx([paragraph(), ...breaks]))).toContain('$.blocks')
    })

    it('estimates dense text near three to four thousand characters per page', () => {
      const pages = estimatePages([
        { type: 'paragraph', runs: [{ text: 'x'.repeat(40000) }] },
      ])

      expect(pages).toBeGreaterThan(8)
      expect(pages).toBeLessThan(14)
    })

    it('limits total cells to 100,000, headers included', () => {
      const wide = (rows: number) => {
        return sheetSpec([{
          name: 'Big',
          columns: Array.from({ length: 10 }, () => ({ header: 'h', type: 'string' })),
          rows: Array.from({ length: rows }, () => Array.from({ length: 10 }, () => 'v')),
        }])
      }

      expect(parseDocumentSpec(wide(9999)).ok).toBe(true)
      expect(issuePaths(wide(10000))).toContain('$.sheets')
    })

    it('limits a deck to 60 slides', () => {
      const slides = (count: number) => {
        return {
          specVersion: 1,
          format: 'pptx',
          title: 'Deck',
          aspect: '16:9',
          slides: Array.from({ length: count }, () => ({ layout: 'section', title: 's' })),
        }
      }

      expect(parseDocumentSpec(slides(60)).ok).toBe(true)
      expect(parseDocumentSpec(slides(61)).ok).toBe(false)
    })
  })

  describe('slides', () => {
    function deck(slide: unknown) {
      return {
        specVersion: 1,
        format: 'pptx',
        title: 'Deck',
        aspect: '4:3',
        slides: [slide],
      }
    }

    it('requires columns for two-column and an image for the image layout', () => {
      expect(issuePaths(deck({ layout: 'two-column', title: 't' })))
        .toContain('$.slides[0].columns')
      expect(issuePaths(deck({ layout: 'image', title: 't' })))
        .toContain('$.slides[0].image')
    })

    it('limits bullets to 12 and notes to 4000 characters', () => {
      const bullets = (count: number) => {
        return Array.from({ length: count }, () => [{ text: 'b' }])
      }

      expect(parseDocumentSpec(deck({ layout: 'title-content', title: 't', bullets: bullets(12) })).ok)
        .toBe(true)
      expect(parseDocumentSpec(deck({ layout: 'title-content', title: 't', bullets: bullets(13) })).ok)
        .toBe(false)
      expect(parseDocumentSpec(deck({ layout: 'section', title: 't', notes: 'n'.repeat(4001) })).ok)
        .toBe(false)
    })
  })

  describe('sheets and cells', () => {
    it.each([
      'a[b',
      'a]b',
      'a:b',
      'a*b',
      'a?b',
      'a/b',
      'a\\b',
      'History',
      'history',
      '',
      'x'.repeat(32),
      '\'quoted',
      'quoted\'',
      '   ',
    ])('rejects the sheet name %j', (name) => {
      expect(issuePaths(sheetSpec([sheet([['a', 1]], name)])))
        .toContain('$.sheets[0].name')
    })

    it('accepts Unicode names of up to 31 characters', () => {
      expect(parseDocumentSpec(sheetSpec([sheet([['a', 1]], 'Продажі Q3'), sheet([['a', 1]], 'x'.repeat(31))])).ok)
        .toBe(true)
    })

    it('rejects duplicate sheet names ignoring case', () => {
      expect(issuePaths(sheetSpec([sheet([], 'Data'), sheet([], 'DATA')])))
        .toContain('$.sheets[1].name')
    })

    it('accepts every cell kind and rejects non-finite numbers', () => {
      const cells = ['text', 1.5, true, null, { date: '2026-11-08' }, { formula: 'SUM(B2:B3)', cached: 3 }]
      const book = sheetSpec([{
        name: 'Kinds',
        columns: cells.map(() => ({ header: 'h', type: 'string' })),
        rows: [cells],
      }])

      expect(parseDocumentSpec(book).ok).toBe(true)
      expect(parseDocumentSpec(sheetSpec([sheet([['a', Number.POSITIVE_INFINITY]])])).ok)
        .toBe(false)
      expect(parseDocumentSpec(sheetSpec([sheet([['a', Number.NaN]])])).ok).toBe(false)
    })

    it('rejects invalid dates and oversize strings and formulas', () => {
      expect(parseDocumentSpec(sheetSpec([sheet([['a', { date: '2026-02-30' }]])])).ok)
        .toBe(false)
      expect(parseDocumentSpec(sheetSpec([sheet([['a', { date: 'tomorrow' }]])])).ok)
        .toBe(false)
      expect(parseDocumentSpec(sheetSpec([sheet([['x'.repeat(32768), 1]])])).ok)
        .toBe(false)
      expect(parseDocumentSpec(sheetSpec([sheet([['x'.repeat(32767), 1]])])).ok)
        .toBe(true)
      expect(parseDocumentSpec(sheetSpec([sheet([['a', { formula: 'A'.repeat(2001) }]])])).ok)
        .toBe(false)
    })

    it('rejects rows longer than the column list with the row path', () => {
      expect(issuePaths(sheetSpec([sheet([['a', 1, 'extra']])])))
        .toContain('$.sheets[0].rows[0]')
    })

    it('bounds column width and count', () => {
      const column = (width: number) => ({ header: 'h', type: 'string', width })
      const book = (columns: unknown[]) => sheetSpec([{ name: 'S', columns, rows: [] }])

      expect(parseDocumentSpec(book([column(4), column(80)])).ok).toBe(true)
      expect(parseDocumentSpec(book([column(3)])).ok).toBe(false)
      expect(parseDocumentSpec(book([column(81)])).ok).toBe(false)
      const tooMany = Array.from({ length: 201 }, () => column(10))

      expect(parseDocumentSpec(book(tooMany)).ok).toBe(false)
    })
  })
})

describe('summarizeSpec', () => {
  function parse(name: 'report' | 'deck' | 'workbook'): DocumentSpec {
    const result = parseDocumentSpec(loadReferenceSpec(name))

    if (!result.ok) {
      throw new Error('fixture must parse')
    }

    return result.spec
  }

  it('describes each format without rendering', () => {
    const report = summarizeSpec(parse('report'))
    const deck = summarizeSpec(parse('deck'))
    const workbook = summarizeSpec(parse('workbook'))

    expect(report.format).toBe('docx')
    expect(report.pages).toBeGreaterThan(5)
    expect(report.images).toBe(2)
    expect(report.outline.length).toBeGreaterThan(0)
    expect(deck.slides).toBe(30)
    expect(workbook.sheets).toBe(3)
    expect(workbook.cells).toBeGreaterThan(10000)
  })
})
