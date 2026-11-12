import { strFromU8, unzipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import { assertOfficeUploadBytes } from '~~/server/utils/files/office-upload-check'
import {
  XlsConvertException,
  convertXlsBytes,
  handleXlsWorkerRequest,
} from '~/workers/xls-convert'
import {
  CFB_SIGNATURE,
  XLS_CONVERT_MAX_INPUT_BYTES,
} from '~/utils/xls-convert'

function toArrayBuffer(output: unknown): ArrayBuffer {
  const bytes = output as ArrayBuffer | Uint8Array

  if (bytes instanceof ArrayBuffer) {
    return bytes
  }

  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function buildXls(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Ключ', 'Створено', 'Сума', 'Статус'],
    ['BES-370', 46338.4375, 12.5, 'Готово'],
    ['BES-371', 46339, 20, 'В роботі'],
  ])

  sheet.B2.z = 'yyyy-mm-dd'
  sheet.B3.z = 'yyyy-mm-dd'

  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(workbook, sheet, 'Задачі')

  return toArrayBuffer(XLSX.write(workbook, { bookType: 'biff8', type: 'array' }))
}

describe('convertXlsBytes', () => {
  it('builds a real BIFF8 file for the fixture', () => {
    const head = new Uint8Array(buildXls(), 0, CFB_SIGNATURE.length)

    expect(Array.from(head)).toEqual([...CFB_SIGNATURE])
  })

  it('converts BIFF8 to an XLSX that keeps sheet names and values', () => {
    const xlsx = convertXlsBytes(buildXls())
    const head = new Uint8Array(xlsx, 0, 2)

    expect(Array.from(head)).toEqual([0x50, 0x4B])

    const workbook = XLSX.read(xlsx, { type: 'array' })

    expect(workbook.SheetNames).toEqual(['Задачі'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['Задачі'], {
      header: 1,
      raw: true,
    })).toEqual([
      ['Ключ', 'Створено', 'Сума', 'Статус'],
      ['BES-370', 46338.4375, 12.5, 'Готово'],
      ['BES-371', 46339, 20, 'В роботі'],
    ])
  })

  it('produces a file the server upload check accepts', () => {
    const xlsx = new Uint8Array(convertXlsBytes(buildXls()))

    expect(() => {
      assertOfficeUploadBytes('report.xlsx', 'xlsx', xlsx)
    }).not.toThrow()
  })

  it('keeps dates and Cyrillic readable for the server text extractor', () => {
    const xlsx = new Uint8Array(convertXlsBytes(buildXls()))
    const result = extractOfficeText(xlsx, 'xlsx')

    expect(result.status).toBe('ready')
    expect(result.text).toContain('Ключ')
    expect(result.text).toContain('В роботі')
    expect(result.text).toContain('2026-11-12')
    expect(result.text).not.toContain('46338')
  })

  it('leaves no macro content type in the package', () => {
    const files = unzipSync(new Uint8Array(convertXlsBytes(buildXls())))
    const contentTypes = strFromU8(files['[Content_Types].xml']!)

    expect(contentTypes).not.toMatch(/macroEnabled|vbaProject/i)
    expect(Object.keys(files).some(name => name.endsWith('.bin')))
      .toBe(false)
  })

  it('refuses bytes that are not a compound file', () => {
    const html = new TextEncoder().encode('<html><table></table></html>')

    expect(() => convertXlsBytes(html.buffer as ArrayBuffer)).toThrowError(
      expect.objectContaining({ reason: 'not-cfb' }),
    )
  })

  it('refuses an empty buffer and a buffer shorter than the signature', () => {
    expect(() => convertXlsBytes(new ArrayBuffer(0))).toThrowError(
      expect.objectContaining({ reason: 'not-cfb' }),
    )
    expect(() => convertXlsBytes(new Uint8Array([0xD0, 0xCF]).buffer))
      .toThrowError(expect.objectContaining({ reason: 'not-cfb' }))
  })

  it('refuses input over the size cap before reading it', () => {
    const oversized = new ArrayBuffer(XLS_CONVERT_MAX_INPUT_BYTES + 1)

    expect(() => convertXlsBytes(oversized)).toThrowError(
      expect.objectContaining({ reason: 'too-large' }),
    )
    expect(() => convertXlsBytes(oversized)).toThrowError(XlsConvertException)
  })

  it('fails on a compound file that is not an Excel workbook', () => {
    const lookalike = new Uint8Array(2048)

    lookalike.set(CFB_SIGNATURE)

    expect(() => convertXlsBytes(lookalike.buffer)).toThrowError()
  })
})

describe('handleXlsWorkerRequest', () => {
  it('answers a converted file and transfers its buffer', () => {
    const { response, transfer } = handleXlsWorkerRequest({
      id: 7,
      bytes: buildXls(),
    })

    expect(response).toMatchObject({ id: 7, ok: true })
    expect(transfer).toHaveLength(1)
  })

  it('answers a typed failure instead of throwing', () => {
    const { response, transfer } = handleXlsWorkerRequest({
      id: 8,
      bytes: new TextEncoder().encode('not an xls').buffer as ArrayBuffer,
    })

    expect(response).toEqual({ id: 8, ok: false, reason: 'not-cfb' })
    expect(transfer).toEqual([])
  })

  it('answers convert-failed when the parser throws', () => {
    const lookalike = new Uint8Array(2048)

    lookalike.set(CFB_SIGNATURE)

    const { response } = handleXlsWorkerRequest({
      id: 9,
      bytes: lookalike.buffer,
    })

    expect(response).toMatchObject({ id: 9, ok: false })
  })
})
