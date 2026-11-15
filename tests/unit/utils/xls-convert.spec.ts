import { describe, expect, it } from 'vitest'
import {
  CFB_SIGNATURE,
  XLSX_MEDIA_TYPE,
  XLS_CONVERT_MAX_INPUT_BYTES,
  XLS_CONVERT_MAX_ROWS,
  XLS_CONVERT_TIMEOUT_MS,
  getConvertedXlsxName,
  hasCfbSignature,
  isXlsFile,
  readsAsCfb,
} from '~/utils/xls-convert'

describe('xls convert utils', () => {
  it('pins the safety limits', () => {
    expect(XLS_CONVERT_MAX_INPUT_BYTES).toBe(20 * 1024 * 1024)
    expect(XLS_CONVERT_TIMEOUT_MS).toBe(30_000)
    expect(XLS_CONVERT_MAX_ROWS).toBe(100_000)
    expect(CFB_SIGNATURE).toEqual([
      0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1,
    ])
    expect(XLSX_MEDIA_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  it('matches only the exact .xls extension', () => {
    expect(isXlsFile({ name: 'jira.xls' })).toBe(true)
    expect(isXlsFile({ name: 'JIRA.XLS' })).toBe(true)
    expect(isXlsFile({ name: 'jira.xlsx' })).toBe(false)
    expect(isXlsFile({ name: 'jira.xlsm' })).toBe(false)
    expect(isXlsFile({ name: 'jira.xlt' })).toBe(false)
    expect(isXlsFile({ name: 'jira.xls.txt' })).toBe(false)
    expect(isXlsFile({ name: 'xls' })).toBe(false)
  })

  it('checks all eight signature bytes', () => {
    expect(hasCfbSignature(new Uint8Array(CFB_SIGNATURE))).toBe(true)
    expect(hasCfbSignature(new Uint8Array([...CFB_SIGNATURE, 1, 2])))
      .toBe(true)
    expect(hasCfbSignature(new Uint8Array(CFB_SIGNATURE.slice(0, 7))))
      .toBe(false)
    expect(hasCfbSignature(new Uint8Array([
      ...CFB_SIGNATURE.slice(0, 7),
      0,
    ]))).toBe(false)
    expect(hasCfbSignature(new Uint8Array())).toBe(false)
    expect(hasCfbSignature(new TextEncoder().encode('<html>'))).toBe(false)
  })

  it('reads the signature from the start of a file', async () => {
    const real = new File([new Uint8Array([...CFB_SIGNATURE, 0, 0])], 'a.xls')
    const html = new File(['<html></html>'], 'a.xls')

    expect(await readsAsCfb(real)).toBe(true)
    expect(await readsAsCfb(html)).toBe(false)
    expect(await readsAsCfb(new File([], 'empty.xls'))).toBe(false)
  })

  it('swaps the extension and keeps the rest of the name', () => {
    expect(getConvertedXlsxName('jira.xls')).toBe('jira.xlsx')
    expect(getConvertedXlsxName('Jira Export.XLS')).toBe('Jira Export.xlsx')
    expect(getConvertedXlsxName('q3.final.xls')).toBe('q3.final.xlsx')
  })
})
