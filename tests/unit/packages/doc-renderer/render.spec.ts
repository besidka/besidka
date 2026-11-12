import { mkdirSync, writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { extractText, getDocumentProxy, getMeta } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import { RenderError, render } from '@besidka/doc-renderer/render'
import type { RenderResult } from '@besidka/doc-renderer/render'
import { validate } from '@besidka/doc-renderer/validate'
import {
  loadFonts,
  loadReferenceAssets,
  loadReferenceSpec,
  loadWorstCaseRules,
} from '~~/tests/setup/helpers/documents'
import type { ReferenceSpecName } from '~~/tests/setup/helpers/documents'

const decoder = new TextDecoder()
const GOLDEN_DIRECTORY = process.env.D2_GOLDEN_DIR

interface GoldenCase {
  name: string
  base: ReferenceSpecName
  override: object
}

const GOLDEN_CASES: GoldenCase[] = [
  { name: 'report', base: 'report', override: {} },
  { name: 'report-pdf', base: 'report-pdf', override: {} },
  { name: 'deck', base: 'deck', override: {} },
  { name: 'workbook', base: 'workbook', override: {} },
  { name: 'showcase', base: 'showcase', override: {} },
  {
    name: 'showcase-pdf',
    base: 'showcase',
    override: { format: 'pdf', pageSize: 'A4' },
  },
]

function parseSpec(input: unknown): DocumentSpec {
  const parsed = parseDocumentSpec(input)

  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }

  return parsed.spec
}

function referenceSpec(testCase: GoldenCase): DocumentSpec {
  return parseSpec({
    ...(loadReferenceSpec(testCase.base) as object),
    ...testCase.override,
  })
}

async function renderSpec(
  spec: DocumentSpec,
  options: Parameters<typeof render>[2] = {},
): Promise<RenderResult> {
  return render(spec, loadReferenceAssets(), { fonts: loadFonts(), ...options })
}

function parts(result: RenderResult): Record<string, string> {
  const archive = unzipSync(result.bytes)

  return Object.fromEntries(
    Object.entries(archive)
      .filter(([name]) => /\.(?:xml|rels)$/.test(name))
      .map(([name, data]) => [name, decoder.decode(data)]),
  )
}

async function renderGolden(testCase: GoldenCase): Promise<RenderResult> {
  const spec = referenceSpec(testCase)
  const result = await renderSpec(spec)

  if (GOLDEN_DIRECTORY) {
    mkdirSync(GOLDEN_DIRECTORY, { recursive: true })
    writeFileSync(
      `${GOLDEN_DIRECTORY}/${testCase.name}.${result.extension}`,
      result.bytes,
    )
  }

  return result
}

describe('reference documents: render, validate, stats', () => {
  it.each(GOLDEN_CASES)('renders $name and passes validate()', async (testCase) => {
    const spec = referenceSpec(testCase)
    const result = await renderGolden(testCase)
    const validated = validate(
      result.extension as 'pdf' | 'docx' | 'pptx' | 'xlsx',
      result.bytes,
      spec.format === 'xlsx' ? { spec } : {},
    )

    expect(validated.ok).toBe(true)

    if (validated.ok) {
      expect(validated.provenance).toBe('ai')
    }

    expect(result.warnings).toEqual([])
    expect(result.bytes.length).toBeLessThanOrEqual(20 * 1024 * 1024)
  }, 60000)

  it('reports stats and media types', async () => {
    const pdf = await renderGolden(GOLDEN_CASES[1] as GoldenCase)
    const deck = await renderGolden(GOLDEN_CASES[2] as GoldenCase)
    const workbook = await renderGolden(GOLDEN_CASES[3] as GoldenCase)
    const docx = await renderGolden(GOLDEN_CASES[0] as GoldenCase)

    expect(pdf.stats.pages).toBeGreaterThanOrEqual(45)
    expect(pdf.stats.pages).toBeLessThanOrEqual(60)
    expect(pdf.mediaType).toBe('application/pdf')
    expect(deck.stats.slides).toBe(30)
    expect(deck.extension).toBe('pptx')
    expect(workbook.stats.sheets).toBe(3)
    expect(workbook.stats.cells).toBeGreaterThan(10000)
    expect(docx.stats.blocks).toBeGreaterThan(0)
    expect(docx.stats.pages).toBeUndefined()
    expect(docx.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  }, 60000)
})

describe('determinism', () => {
  it.each(GOLDEN_CASES)('renders $name byte-identically twice', async (testCase) => {
    const spec = referenceSpec(testCase)
    const first = await renderSpec(spec)
    const second = await renderSpec(spec)

    expect(first.bytes).toEqual(second.bytes)

    if (first.extension !== 'pdf') {
      expect(parts(first)).toEqual(parts(second))
    }
  }, 60000)

  it('pins the core.xml dates unless createdAt is given', async () => {
    const spec = parseSpec(loadReferenceSpec('report'))
    const pinned = parts(await renderSpec(spec))['docProps/core.xml'] as string
    const dated = parts(await renderSpec(spec, {
      createdAt: '2027-02-03T04:05:06Z',
    }))['docProps/core.xml'] as string

    expect(pinned).toContain('2026-01-01T00:00:00Z')
    expect(dated).toContain('2027-02-03T04:05:06Z')
    expect(dated).not.toContain('2026-01-01T00:00:00Z')
  })
})

describe('structure: title, language and headings in every format', () => {
  it('DOCX: heading styles, language, title and provenance', async () => {
    const spec = parseSpec(loadReferenceSpec('report'))
    const result = await renderSpec(spec, {
      provenance: { createdVia: 'chat', model: 'claude-test' },
    })
    const files = parts(result)
    const document = files['word/document.xml'] as string

    expect(document).toContain('w:val="Heading1"')
    expect(document).toContain('w:val="Heading2"')
    expect(document).toContain('w:val="Heading3"')
    expect(files['word/styles.xml']).toContain('w:lang w:val="uk-UA"')
    expect(files['docProps/core.xml']).toContain(
      '<dc:title>Квартальний звіт / Quarterly report Q3 2026</dc:title>',
    )
    expect(files['docProps/core.xml']).toContain('<dc:language>uk-UA</dc:language>')
    expect(files['docProps/custom.xml']).toContain('claude-test')
    expect(document).toContain('<w:tblHeader')
    expect(document).toContain('descr=')
  })

  it('PPTX: a title placeholder on every slide, language and notes', async () => {
    const spec = parseSpec(loadReferenceSpec('deck'))
    const result = await renderSpec(spec)
    const files = parts(result)
    const slides = Object.keys(files).filter((name) => {
      return /^ppt\/slides\/slide\d+\.xml$/.test(name)
    })

    expect(slides).toHaveLength(30)

    for (const name of slides) {
      expect(files[name], name).toContain('type="title"')
    }

    expect(files['docProps/core.xml']).toContain('<dc:language>uk-UA</dc:language>')
    expect(files['docProps/core.xml']).toContain('<dc:title>')
    expect(files['ppt/slides/slide1.xml']).toContain('lang="uk-UA"')
    expect(
      Object.keys(files).filter(name => name.startsWith('ppt/notesSlides/')),
    ).not.toHaveLength(0)
  })

  it('XLSX: bold header row, frozen pane, sheet names, title and formulas', async () => {
    const spec = parseSpec(loadReferenceSpec('workbook'))
    const result = await renderSpec(spec)
    const files = parts(result)
    const sheet = files['xl/worksheets/sheet1.xml'] as string

    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('ySplit="1"')
    expect(files['xl/workbook.xml']).toContain('name="Продажі"')
    expect(files['xl/workbook.xml']).toContain('name="Підсумок - Summary"')
    expect(files['docProps/core.xml']).toContain('<dc:title>')
    expect(files['docProps/core.xml']).toContain('<dc:language>uk-UA</dc:language>')
    expect(files['xl/styles.xml']).toContain('<b/>')
    expect(files['xl/worksheets/sheet3.xml']).toMatch(/<f>SUM\(/)
  })

  it('XLSX: text that starts with = + - @ stays an inert string', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'xlsx',
      title: 'Inert',
      sheets: [{
        name: 'S',
        columns: [{ header: 'Text', type: 'string' }],
        rows: [['=WEBSERVICE("https://x")'], ['+1'], ['-1'], ['@SUM(1)'], ['cmd|calc']],
      }],
    })
    const result = await renderSpec(spec)
    const files = parts(result)

    expect(files['xl/worksheets/sheet1.xml']).not.toContain('<f>')
    expect(validate('xlsx', result.bytes, { spec }).ok).toBe(true)
  })

  it('XLSX: prefixes future functions so Excel does not show #NAME?', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'xlsx',
      title: 'Future',
      sheets: [{
        name: 'S',
        columns: [{ header: 'A', type: 'number' }, { header: 'B', type: 'number' }],
        rows: [
          [1, { formula: 'IFS(A2>0,1,TRUE,0)' }],
          [2, { formula: 'CONCAT("a","XLOOKUP(")' }],
        ],
      }],
    })
    const sheet = parts(await renderSpec(spec))['xl/worksheets/sheet1.xml'] as string

    expect(sheet).toContain('_xlfn.IFS(')
    expect(sheet).toContain('_xlfn.CONCAT(')
    expect(sheet).not.toContain('_xlfn.XLOOKUP(')
  })

  it('PDF: title, language, text and XMP survive a round trip', async () => {
    const spec = parseSpec({
      ...(loadReferenceSpec('showcase') as object),
      format: 'pdf',
      pageSize: 'Letter',
    })
    const result = await renderSpec(spec, {
      provenance: { createdVia: 'chat', model: 'gpt-test' },
    })
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const { text, totalPages } = await extractText(document, {
      mergePages: true,
    })
    const meta = await getMeta(document)
    const raw = decoder.decode(result.bytes)

    expect(totalPages).toBe(result.stats.pages)
    expect(text).toContain('Огляд можливостей')
    expect(text).toContain('Простота є найвищою мірою досконалості')
    expect(text).not.toContain('�')
    expect(meta.info).toMatchObject({ Title: 'Showcase / Огляд можливостей' })
    expect(meta.info).toMatchObject({ Language: 'uk-UA' })
    expect(raw).toContain('Iptc4xmpExt:AISystemUsed="gpt-test"')
  })

  it('PDF: Cyrillic text of the 50-page reference extracts exactly', async () => {
    const result = await renderGolden(GOLDEN_CASES[1] as GoldenCase)
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const { text } = await extractText(document, { mergePages: true })

    expect(text).toContain('Річний огляд ринку')
    expect(text).toContain('Їжак, ящірка та ґава')
    expect(text).not.toContain('�')
  }, 60000)

  it('PDF: link annotations and URI actions pass validation', async () => {
    const spec = parseSpec({
      ...(loadReferenceSpec('showcase') as object),
      format: 'pdf',
      pageSize: 'A4',
    })
    const result = await renderSpec(spec)
    const document = await getDocumentProxy(new Uint8Array(result.bytes))
    const page = await document.getPage(1)
    const annotations = await page.getAnnotations()
    const urls = annotations.map(annotation => annotation.url)

    expect(validate('pdf', result.bytes).ok).toBe(true)
    expect(urls).toContain('https://besidka.com/')
    expect(urls).toContain('mailto:hello@example.com')
    expect(urls).toContain('https://besidka.com/guides')
  })
})

describe('provenance options', () => {
  it('writes channel-only marks for caller-supplied content', async () => {
    const spec = parseSpec(loadReferenceSpec('report'))
    const result = await renderSpec(spec, {
      provenance: { createdVia: 'mcp', aiGenerated: false },
    })
    const validated = validate('docx', result.bytes)

    expect(validated.ok && validated.provenance).toBe('channel-only')
  })

  it('always writes provenance, even without options', async () => {
    for (const name of ['report', 'workbook', 'deck'] as const) {
      const spec = parseSpec(loadReferenceSpec(name))
      const result = await renderSpec(spec)
      const validated = validate(
        result.extension as 'docx' | 'pptx' | 'xlsx',
        result.bytes,
      )

      expect(validated.ok && validated.provenance, name).toBe('ai')
    }
  })
})

describe('render guards', () => {
  const documentWithImage = (fileId: string) => {
    return parseSpec({
      specVersion: 1,
      format: 'docx',
      title: 'Images',
      blocks: [{ type: 'image', fileId, alt: 'alt', widthPercent: 50 }],
    })
  }

  async function failureCode(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
    } catch (exception) {
      if (exception instanceof RenderError) {
        return exception.code
      }

      throw exception
    }

    return 'none'
  }

  it('fails with missing_asset when an image is not provided', async () => {
    expect(await failureCode(render(documentWithImage('nope'), new Map())))
      .toBe('missing_asset')
  })

  it('rejects WebP, which no chosen library can embed', async () => {
    const assets = new Map([[
      'webp',
      { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' as const },
    ]])

    expect(await failureCode(render(documentWithImage('webp'), assets)))
      .toBe('unsupported_image')
  })

  it('rejects bytes that do not match the declared media type', async () => {
    const assets = new Map([[
      'fake',
      { bytes: new Uint8Array(100).fill(7), mediaType: 'image/png' as const },
    ]])

    expect(await failureCode(render(documentWithImage('fake'), assets)))
      .toBe('unsupported_image')
  })

  it('enforces the 5 MB image and 20 MB total limits', async () => {
    const png = loadReferenceAssets().get('chart-revenue.png')
    const oversize = new Uint8Array(5 * 1024 * 1024 + 1)

    oversize.set(png?.bytes ?? [])

    expect(await failureCode(render(
      documentWithImage('big'),
      new Map([['big', { bytes: oversize, mediaType: 'image/png' as const }]]),
    ))).toBe('image_too_large')

    const assets = new Map(
      Array.from({ length: 5 }, (_unused, index) => {
        return [
          `f${index}`,
          {
            bytes: new Uint8Array(4.5 * 1024 * 1024),
            mediaType: 'image/png' as const,
          },
        ] as const
      }),
    )

    expect(await failureCode(render(documentWithImage('f0'), assets)))
      .toBe('assets_too_large')
  })

  it('requires fonts for PDF', async () => {
    const spec = parseSpec({
      ...(loadReferenceSpec('showcase') as object),
      format: 'pdf',
      pageSize: 'A4',
    })

    expect(await failureCode(render(spec, loadReferenceAssets())))
      .toBe('font_missing')
  })

  it('re-checks bounds before spending CPU', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'docx',
      title: 'Pages',
      blocks: [{ type: 'paragraph', runs: [{ text: 'x' }] }],
    })
    const oversize = {
      ...spec,
      blocks: Array.from({ length: 200 }, () => ({ type: 'pageBreak' as const })),
    } as DocumentSpec

    expect(await failureCode(render(oversize, new Map()))).toBe('invalid_spec')
  })

  it('refuses a formula the validator would reject', async () => {
    const spec = {
      specVersion: 1,
      format: 'xlsx',
      title: 'Bad',
      sheets: [{
        name: 'S',
        columns: [{ header: 'A', type: 'string' }],
        rows: [[{ formula: 'WEBSERVICE("https://x")' }]],
      }],
    } as DocumentSpec

    expect(await failureCode(render(spec, new Map()))).toBe('invalid_spec')
  })

  it('replaces characters the font lacks and says so', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'pdf',
      title: 'Glyphs',
      pageSize: 'A4',
      blocks: [{
        type: 'paragraph',
        runs: [{ text: 'Hello \u{1F600} 世界' }],
      }],
    })
    const result = await renderSpec(spec)

    expect(result.warnings[0]).toContain('unsupported character')
    expect(validate('pdf', result.bytes).ok).toBe(true)
  })
})

describe('bounds at the limit', () => {
  it('renders a 200-page PDF and reports it', async () => {
    const spec = parseSpec({
      specVersion: 1,
      format: 'pdf',
      title: 'Two hundred',
      pageSize: 'A4',
      blocks: [
        { type: 'paragraph', runs: [{ text: 'page' }] },
        ...Array.from({ length: 199 }, () => ({ type: 'pageBreak' })),
      ],
    })
    const result = await renderSpec(spec)
    const validated = validate('pdf', result.bytes)

    expect(result.stats.pages).toBe(200)
    expect(validated.ok && validated.stats.pages).toBe(200)
  }, 60000)

  it('renders the 60-slide and 100,000-cell worst cases', async () => {
    const rules = loadWorstCaseRules() as {
      cases: { name: string, repeatSlides?: number, repeatRows?: number }[]
    }
    const deckRule = rules.cases.find(rule => rule.name === 'presentation-60-slides')
    const workbookRule = rules.cases.find(rule => rule.name === 'workbook-100k-cells')
    const deck = loadReferenceSpec('deck') as { slides: unknown[] }
    const workbook = loadReferenceSpec('workbook') as {
      sheets: { rows: unknown[][] }[]
    }

    deck.slides = Array.from({ length: deckRule?.repeatSlides ?? 2 })
      .flatMap(() => deck.slides)

    for (const sheet of workbook.sheets) {
      sheet.rows = Array.from({ length: workbookRule?.repeatRows ?? 10 })
        .flatMap(() => sheet.rows)
    }

    const deckResult = await renderSpec(parseSpec(deck))
    const workbookResult = await renderSpec(parseSpec(workbook))

    expect(deckResult.stats.slides).toBe(60)
    expect(workbookResult.stats.cells).toBeGreaterThan(90000)
    expect(validate('pptx', deckResult.bytes).ok).toBe(true)
    expect(validate('xlsx', workbookResult.bytes).ok).toBe(true)
  }, 120000)

  it('shows the 200-page text worst case is capped by the serialized limit', () => {
    const base = loadReferenceSpec('report-pdf') as { blocks: unknown[] }
    const expanded = {
      ...base,
      format: 'pdf',
      pageSize: 'A4',
      blocks: Array.from({ length: 4 }).flatMap(() => base.blocks),
    }
    const result = parseDocumentSpec(expanded)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('characters')
    }
  })
})
