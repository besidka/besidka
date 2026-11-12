import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  EXTRACT_FORMATS,
  EXTRACT_LIMITS,
  EXTRACT_VERSION,
  extractOfficeText,
} from '@besidka/doc-renderer/extract'
import type { ExtractFormat } from '@besidka/doc-renderer/extract'
import {
  declareUncompressedSize,
  markEncrypted,
  markZip64,
  zipWithManyEntries,
} from '../../../fixtures/documents/malicious/builders'
import {
  MAIN_CONTENT_TYPES,
  SAMPLE_SPECS,
  docxPackage,
  paragraphXml,
  plainZip,
  pptxPackage,
  renderSpec,
  slideXml,
  worksheetXml,
  xlsxPackage,
} from '../../../fixtures/documents/extract/builders'

const MACRO_DOCX_TYPE
  = 'application/vnd.ms-word.document.macroEnabled.main+xml'
const MACRO_XLSX_TYPE
  = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
const MEBIBYTE = 1024 * 1024

function compoundFileHeader(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size)

  bytes.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])

  return bytes
}

function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2)

  for (let index = 0; index < text.length; index += 1) {
    bytes[index * 2] = text.charCodeAt(index)
  }

  return bytes
}

function expectFailure(
  result: ReturnType<typeof extractOfficeText>,
  status: 'failed' | 'too_large',
  errorCode: string,
) {
  expect(result.status).toBe(status)
  expect(result.errorCode).toBe(errorCode)
  expect(result.text).toBe('')
  expect(result.truncated).toBe(false)
}

describe('extractOfficeText: contract', () => {
  it('exposes the limits the plan fixes', () => {
    expect(EXTRACT_LIMITS).toMatchObject({
      textBytesMax: MEBIBYTE,
      zipEntriesMax: 5000,
      zipTotalBytesMax: 150 * MEBIBYTE,
      zipEntryBytesMax: 50 * MEBIBYTE,
      sheetsMax: 50,
      rowsMax: 1000,
      columnsMax: 200,
      cellCharsMax: 2000,
    })
    expect(EXTRACT_FORMATS).toEqual(['docx', 'xlsx', 'pptx'])
    expect(EXTRACT_VERSION).toBe(1)
  })

  it('reads every format from a real renderer output', async () => {
    for (const format of EXTRACT_FORMATS) {
      const bytes = await renderSpec(SAMPLE_SPECS[format])
      const result = extractOfficeText(bytes, format)

      expect(result.status, format).toBe('ready')
      expect(result.stats.inputBytes).toBe(bytes.length)
      expect(result.stats.entries).toBeGreaterThan(3)
      expect(result.stats.textBytes).toBe(
        new TextEncoder().encode(result.text).length,
      )
    }
  })

  it('rejects an unknown format and empty or oversize input', () => {
    const bytes = docxPackage(paragraphXml('x'))

    expectFailure(
      extractOfficeText(bytes, 'rtf' as ExtractFormat),
      'failed',
      'unsupported_format',
    )
    expectFailure(
      extractOfficeText(new Uint8Array(0), 'docx'),
      'failed',
      'empty_file',
    )
    expectFailure(
      extractOfficeText(bytes, 'docx', { fileBytesMax: bytes.length - 1 }),
      'too_large',
      'file_too_large',
    )
  })

  it('never throws on garbage input', () => {
    const valid = docxPackage(paragraphXml('hello'))
    const inputs: Uint8Array[] = [
      new Uint8Array([1, 2, 3]),
      strToU8('%PDF-1.7 not an office file'),
      valid.subarray(0, valid.length - 10),
      valid.subarray(0, 30),
      new Uint8Array(5000).fill(0x50),
    ]

    for (const input of inputs) {
      for (const format of EXTRACT_FORMATS) {
        const result = extractOfficeText(input, format)

        expect(result.status).toBe('failed')
        expect(result.text).toBe('')
        expect(result.errorCode).toBeTruthy()
      }
    }
  })

  it('rejects a package of another format', () => {
    const workbook = xlsxPackage([
      { name: 'A', xml: worksheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>') },
    ])

    expectFailure(
      extractOfficeText(workbook, 'docx'),
      'failed',
      'ooxml_format_mismatch',
    )
    expectFailure(
      extractOfficeText(docxPackage(paragraphXml('x')), 'pptx'),
      'failed',
      'ooxml_format_mismatch',
    )
  })

  it('rejects a package without content types', () => {
    const bytes = plainZip({ 'word/document.xml': '<w:document/>' })

    expectFailure(
      extractOfficeText(bytes, 'docx'),
      'failed',
      'ooxml_malformed',
    )
  })
})

describe('extractOfficeText: encrypted, legacy and macro files', () => {
  it('rejects an encrypted OOXML package by its compound file header', () => {
    const bytes = compoundFileHeader()

    bytes.set(utf16('EncryptionInfo'), 1024)
    bytes.set(utf16('EncryptedPackage'), 2048)

    for (const format of EXTRACT_FORMATS) {
      expectFailure(
        extractOfficeText(bytes, format),
        'failed',
        'ooxml_encrypted',
      )
    }
  })

  it('rejects legacy binary Office files', () => {
    const bytes = compoundFileHeader()

    bytes.set(utf16('WordDocument'), 1024)

    expectFailure(
      extractOfficeText(bytes, 'docx'),
      'failed',
      'legacy_office_format',
    )
  })

  it('rejects macro-enabled content types', () => {
    const document = docxPackage(paragraphXml('text'), {
      options: { mainContentType: MACRO_DOCX_TYPE },
    })
    const workbook = xlsxPackage(
      [{ name: 'A', xml: worksheetXml('') }],
      { options: { mainContentType: MACRO_XLSX_TYPE } },
    )

    expectFailure(
      extractOfficeText(document, 'docx'),
      'failed',
      'ooxml_macro',
    )
    expectFailure(
      extractOfficeText(workbook, 'xlsx'),
      'failed',
      'ooxml_macro',
    )
  })

  it('rejects a package that carries a VBA project', () => {
    const bytes = docxPackage(paragraphXml('text'), {
      options: {
        extraFiles: { 'word/vbaProject.bin': new Uint8Array([1, 2, 3]) },
        extraContentTypes:
          '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
      },
    })

    expectFailure(extractOfficeText(bytes, 'docx'), 'failed', 'ooxml_macro')
  })

  it('accepts the ordinary content type', () => {
    const bytes = docxPackage(paragraphXml('text'), {
      options: { mainContentType: MAIN_CONTENT_TYPES.docx },
    })

    expect(extractOfficeText(bytes, 'docx').status).toBe('ready')
  })
})

describe('extractOfficeText: ZIP limits', () => {
  it('rejects more than 5000 entries', () => {
    const bytes = zipWithManyEntries(5001)

    expectFailure(
      extractOfficeText(bytes, 'docx'),
      'too_large',
      'zip_too_many_entries',
    )
  })

  it('accepts 5000 entries where the validator would not', () => {
    const archive: Record<string, Uint8Array> = {}

    for (let index = 0; index < 4990; index += 1) {
      archive[`word/media/image${index}.png`] = strToU8('x')
    }

    const base = docxPackage(paragraphXml('many parts'), {
      options: { extraFiles: archive },
    })

    expect(extractOfficeText(base, 'docx').status).toBe('ready')
  })

  it('rejects an entry larger than the entry limit', () => {
    const bytes = docxPackage(paragraphXml('x'), {
      options: { extraFiles: { 'word/media/big.bin': new Uint8Array(5000) } },
    })

    expectFailure(
      extractOfficeText(bytes, 'docx', { zipEntryBytesMax: 4000 }),
      'too_large',
      'zip_entry_too_large',
    )
  })

  it('rejects an archive larger than the total limit', () => {
    const files: Record<string, Uint8Array> = {}

    for (let index = 0; index < 5; index += 1) {
      files[`word/media/part${index}.bin`] = new Uint8Array(3000).fill(index)
    }

    const bytes = docxPackage(paragraphXml('x'), {
      options: { extraFiles: files },
    })

    expectFailure(
      extractOfficeText(bytes, 'docx', { zipTotalBytesMax: 10000 }),
      'too_large',
      'zip_total_too_large',
    )
  })

  it('rejects a high compression ratio at the default limits', () => {
    const bomb = new Uint8Array(24 * MEBIBYTE)
    const bytes = docxPackage(paragraphXml('x'), {
      options: { extraFiles: { 'word/media/zeros.bin': bomb } },
    })

    expectFailure(
      extractOfficeText(bytes, 'docx'),
      'too_large',
      'zip_ratio',
    )
  })

  it('rejects an entry that inflates beyond its declared size', () => {
    const honest = docxPackage(paragraphXml('x'.repeat(5000)))
    const forged = declareUncompressedSize(honest, 'word/document.xml', 200)

    expectFailure(
      extractOfficeText(forged, 'docx'),
      'failed',
      'zip_size_mismatch',
    )
  })

  it('rejects zip64 and encrypted entries through the shared reader', () => {
    const bytes = docxPackage(paragraphXml('x'))

    expectFailure(
      extractOfficeText(markZip64(bytes), 'docx'),
      'failed',
      'zip64',
    )
    expectFailure(
      extractOfficeText(markEncrypted(bytes, 'word/document.xml'), 'docx'),
      'failed',
      'zip_encrypted',
    )
  })
})

describe('extractOfficeText: presentations and workbooks stay bounded', () => {
  it('reads a slide part beyond its first megabyte', () => {
    const filler = 'text '.repeat(260000)
    const slides = [{ xml: slideXml(`<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${filler}</a:t></a:r></a:p></p:txBody></p:sp>`) }]
    const result = extractOfficeText(pptxPackage(slides), 'pptx')

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toEqual(['text_limit'])
    expect(new TextEncoder().encode(result.text).length)
      .toBeLessThanOrEqual(EXTRACT_LIMITS.textBytesMax)
  })
})
