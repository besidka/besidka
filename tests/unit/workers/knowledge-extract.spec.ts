import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractKnowledgeBytes,
  handleKnowledgeWorkerRequest,
} from '~/workers/knowledge-extract'
import {
  createEmptyDocx,
  createMinimalDocx,
  createMinimalPdf,
  createMinimalXlsx,
  toArrayBuffer,
} from '../../setup/helpers/knowledge-fixtures'

vi.mock('mammoth', async (importOriginal) => {
  const original = await importOriginal<{ default: MammothModule }>()
  const mammoth = original.default

  return {
    default: {
      ...mammoth,
      convertToHtml: (
        input: { arrayBuffer: ArrayBuffer },
        options: unknown,
      ) => {
        return mammoth.convertToHtml(
          { buffer: Buffer.from(input.arrayBuffer) },
          options,
        )
      },
    },
  }
})

interface MammothModule {
  convertToHtml: (input: unknown, options?: unknown) => Promise<unknown>
}

const encoder = new TextEncoder()
const HASH_PATTERN = /^[a-f0-9]{64}$/

function toBuffer(text: string): ArrayBuffer {
  return toArrayBuffer(encoder.encode(text))
}

function sha256(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractKnowledgeBytes text', () => {
  it('returns ready text with the SHA-256 of the original bytes', async () => {
    const bytes = toBuffer('# Notes\n\nHello knowledge')

    const result = await extractKnowledgeBytes({ name: 'notes.md', bytes })

    expect(result).toEqual({
      extractor: 'text',
      extractStatus: 'ready',
      extractError: null,
      text: '# Notes\n\nHello knowledge',
      pageCount: null,
      contentHash: sha256(bytes),
    })
    expect(result.contentHash).toMatch(HASH_PATTERN)
  })

  it('strips a UTF-8 byte order mark and keeps Cyrillic text', async () => {
    const body = encoder.encode('Привіт, світе')
    const bytes = new Uint8Array(body.length + 3)

    bytes.set([0xEF, 0xBB, 0xBF])
    bytes.set(body, 3)

    const result = await extractKnowledgeBytes({
      name: 'greeting.txt',
      bytes: toArrayBuffer(bytes),
    })

    expect(result.text).toBe('Привіт, світе')
  })

  it('treats empty and whitespace-only files as no-text', async () => {
    const empty = await extractKnowledgeBytes({
      name: 'empty.txt',
      bytes: new ArrayBuffer(0),
    })
    const blank = await extractKnowledgeBytes({
      name: 'blank.txt',
      bytes: toBuffer('  \n\t\n'),
    })

    expect(empty.extractStatus).toBe('no-text')
    expect(blank.extractStatus).toBe('no-text')
    expect(blank.text).toBe('')
    expect(blank.contentHash).toMatch(HASH_PATTERN)
  })

  it('rejects files with a NUL byte as binary', async () => {
    const bytes = toArrayBuffer(new Uint8Array([0x61, 0x00, 0x62]))

    const result = await extractKnowledgeBytes({ name: 'data.txt', bytes })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('binary')
    expect(result.text).toBe('')
  })

  it('rejects invalid UTF-8 without replacement characters', async () => {
    const bytes = toArrayBuffer(new Uint8Array([0x61, 0xFF, 0xFE, 0x62]))

    const result = await extractKnowledgeBytes({ name: 'latin.txt', bytes })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('not-utf8')
    expect(result.contentHash).toMatch(HASH_PATTERN)
  })

  it('accepts a text file at the 1 MB limit and rejects one byte more', async () => {
    const limit = 1024 * 1024
    const atLimit = await extractKnowledgeBytes({
      name: 'big.txt',
      bytes: toArrayBuffer(new Uint8Array(limit).fill(0x61)),
    })
    const overLimit = await extractKnowledgeBytes({
      name: 'bigger.txt',
      bytes: toArrayBuffer(new Uint8Array(limit + 1).fill(0x61)),
    })

    expect(atLimit.extractStatus).toBe('ready')
    expect(overLimit.extractStatus).toBe('failed')
    expect(overLimit.extractError).toBe('too-large')
  })

  it('recognizes extensionless Dockerfile as text', async () => {
    const result = await extractKnowledgeBytes({
      name: 'Dockerfile',
      bytes: toBuffer('FROM node:22'),
    })

    expect(result.extractStatus).toBe('ready')
  })
})

describe('extractKnowledgeBytes routing and limits', () => {
  it('fails unsupported extensions with a short code', async () => {
    const result = await extractKnowledgeBytes({
      name: 'archive.zip',
      bytes: toBuffer('PK'),
    })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('unsupported')
  })

  it('hashes images without extracting them', async () => {
    const bytes = toArrayBuffer(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0]))

    const result = await extractKnowledgeBytes({ name: 'shot.png', bytes })

    expect(result.extractStatus).toBe('no-text')
    expect(result.extractor).toBe('text')
    expect(result.text).toBe('')
    expect(result.contentHash).toBe(sha256(bytes))
  })

  it('rejects originals over 30 MB before hashing', async () => {
    const result = await extractKnowledgeBytes({
      name: 'huge.pdf',
      bytes: new ArrayBuffer(30 * 1024 * 1024 + 1),
    })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('too-large')
    expect(result.contentHash).toBe('')
  })

  it('keeps every error code within 64 characters', async () => {
    const results = await Promise.all([
      extractKnowledgeBytes({ name: 'a.pdf', bytes: toBuffer('nope') }),
      extractKnowledgeBytes({ name: 'a.docx', bytes: toBuffer('nope') }),
      extractKnowledgeBytes({ name: 'a.xlsx', bytes: toBuffer('nope') }),
    ])

    for (const result of results) {
      expect(result.extractStatus).toBe('failed')
      expect(result.extractError?.length).toBeLessThanOrEqual(64)
    }
  })

  it('wraps the result with the request id for the worker protocol', async () => {
    const response = await handleKnowledgeWorkerRequest({
      id: 7,
      name: 'notes.md',
      bytes: toBuffer('hello'),
    })

    expect(response.id).toBe(7)
    expect(response.text).toBe('hello')
    expect(response.extractStatus).toBe('ready')
  })
})

describe('extractKnowledgeBytes PDF', () => {
  it('extracts pages and merges them with blank lines', async () => {
    const bytes = toArrayBuffer(createMinimalPdf([
      'First page has enough readable text',
      'Second page also has readable text',
    ]))

    const result = await extractKnowledgeBytes({ name: 'doc.pdf', bytes })

    expect(result.extractStatus).toBe('ready')
    expect(result.extractor).toBe('client-unpdf')
    expect(result.pageCount).toBe(2)
    expect(result.text).toBe(
      'First page has enough readable text\n\n'
      + 'Second page also has readable text',
    )
    expect(result.contentHash).toMatch(HASH_PATTERN)
  })

  it('flags a PDF without text as scanned (no-text)', async () => {
    const result = await extractKnowledgeBytes({
      name: 'scan.pdf',
      bytes: toArrayBuffer(createMinimalPdf(['', ''])),
    })

    expect(result.extractStatus).toBe('no-text')
    expect(result.pageCount).toBe(2)
    expect(result.text).toBe('')
  })

  it('flags a PDF with under 20 characters per page as no-text', async () => {
    const result = await extractKnowledgeBytes({
      name: 'sparse.pdf',
      bytes: toArrayBuffer(createMinimalPdf(['Hi', 'There'])),
    })

    expect(result.extractStatus).toBe('no-text')
  })

  it('rejects PDFs over 500 pages', async () => {
    const pages = Array.from({ length: 501 }, () => '')

    const result = await extractKnowledgeBytes({
      name: 'long.pdf',
      bytes: toArrayBuffer(createMinimalPdf(pages)),
    })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('too-many-pages')
  })

  it('maps a corrupt PDF to a short failure code', async () => {
    const result = await extractKnowledgeBytes({
      name: 'broken.pdf',
      bytes: toBuffer('%PDF-1.4 this is not a real document'),
    })

    expect(result.extractStatus).toBe('failed')
    expect(['invalid-pdf', 'pdf-failed']).toContain(result.extractError)
  })

  it('reports ios-update-required when the Iterator global is missing', async () => {
    vi.stubGlobal('Iterator', undefined)

    const result = await extractKnowledgeBytes({
      name: 'doc.pdf',
      bytes: toArrayBuffer(createMinimalPdf(['Text that would be extracted'])),
    })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('ios-update-required')
    expect(result.contentHash).toMatch(HASH_PATTERN)
  })
})

describe('extractKnowledgeBytes DOCX', () => {
  it('returns HTML for the main thread and no text', async () => {
    const bytes = toArrayBuffer(createMinimalDocx())

    const result = await extractKnowledgeBytes({ name: 'plan.docx', bytes })

    expect(result.extractStatus).toBe('ready')
    expect(result.extractor).toBe('client-mammoth')
    expect(result.text).toBe('')
    expect(result.html).toContain('<h1>Project Plan</h1>')
    expect(result.html).toContain('<strong>knowledge</strong>')
    expect(result.contentHash).toBe(sha256(bytes))
  })

  it('treats a document without content as no-text', async () => {
    const result = await extractKnowledgeBytes({
      name: 'empty.docx',
      bytes: toArrayBuffer(createEmptyDocx()),
    })

    expect(result.extractStatus).toBe('no-text')
    expect(result.html).toBeUndefined()
  })
})

describe('extractKnowledgeBytes XLSX', () => {
  it('renders every sheet as a Markdown table', async () => {
    const bytes = toArrayBuffer(createMinimalXlsx([
      {
        name: 'People',
        rows: [
          ['Name', 'Score'],
          ['Ada | Lovelace', 10],
          ['Line\nBreak', null],
        ],
      },
      { name: 'Empty', rows: [] },
      { name: 'Notes', rows: [['Only header']] },
    ]))

    const result = await extractKnowledgeBytes({ name: 'data.xlsx', bytes })

    expect(result.extractStatus).toBe('ready')
    expect(result.extractor).toBe('client-xlsx')
    expect(result.text).toBe([
      '## People',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Ada \\| Lovelace | 10 |',
      '| Line Break |  |',
      '',
      '## Notes',
      '',
      '| Only header |',
      '| --- |',
    ].join('\n'))
    expect(result.contentHash).toBe(sha256(bytes))
  })

  it('caps rows per sheet and notes how many were omitted', async () => {
    const rows: Array<Array<string | number | null>> = [['Index']]

    for (let index = 1; index <= 1005; index += 1) {
      rows.push([index])
    }

    const result = await extractKnowledgeBytes({
      name: 'long.xlsx',
      bytes: toArrayBuffer(createMinimalXlsx([{ name: 'Rows', rows }])),
    })

    const tableLines = result.text
      .split('\n')
      .filter(line => line.startsWith('| '))

    expect(tableLines).toHaveLength(1002)
    expect(result.text.endsWith('(5 more rows omitted)')).toBe(true)
  })

  it('treats a workbook with only empty sheets as no-text', async () => {
    const result = await extractKnowledgeBytes({
      name: 'empty.xlsx',
      bytes: toArrayBuffer(createMinimalXlsx([{ name: 'Blank', rows: [] }])),
    })

    expect(result.extractStatus).toBe('no-text')
  })
})
