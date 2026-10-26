import { describe, expect, it } from 'vitest'
import { readZipSummary } from '~/utils/knowledge-zip'
import {
  createMinimalDocx,
  createStoredZip,
  createZipWithDeclaredSizes,
  toArrayBuffer,
} from '../../setup/helpers/knowledge-fixtures'

const FOUR_GIGABYTES_MINUS_ONE_MEGABYTE = 4_293_918_720

describe('readZipSummary', () => {
  it('sums the declared sizes of a normal archive', () => {
    const summary = readZipSummary(createStoredZip({
      'a.txt': 'hello',
      'b/c.txt': 'world!!',
    }))

    expect(summary).toEqual({
      entries: 2,
      uncompressedBytes: 12,
      largestEntryBytes: 7,
    })
  })

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const archive = createMinimalDocx()

    expect(readZipSummary(toArrayBuffer(archive)))
      .toEqual(readZipSummary(archive))
    expect(readZipSummary(archive)?.entries).toBeGreaterThan(0)
  })

  it('reports huge declared sizes without inflating anything', () => {
    const summary = readZipSummary(createZipWithDeclaredSizes([
      { name: 'a.xml', uncompressedSize: FOUR_GIGABYTES_MINUS_ONE_MEGABYTE },
      { name: 'b.xml', uncompressedSize: FOUR_GIGABYTES_MINUS_ONE_MEGABYTE },
    ]))

    expect(summary).toEqual({
      entries: 2,
      uncompressedBytes: FOUR_GIGABYTES_MINUS_ONE_MEGABYTE * 2,
      largestEntryBytes: FOUR_GIGABYTES_MINUS_ONE_MEGABYTE,
    })
  })

  it('counts many entries', () => {
    const entries = Array.from({ length: 6000 }, (_entry, index) => {
      return { name: `part-${index}.xml`, uncompressedSize: 1 }
    })

    expect(readZipSummary(createZipWithDeclaredSizes(entries)))
      .toEqual({ entries: 6000, uncompressedBytes: 6000, largestEntryBytes: 1 })
  })

  it('finds the record after a trailing archive comment', () => {
    const archive = createStoredZip({ 'a.txt': 'hi' })
    const comment = new TextEncoder().encode('made by a tool')
    const withComment = new Uint8Array(archive.length + comment.length)

    withComment.set(archive)
    withComment.set(comment, archive.length)
    new DataView(withComment.buffer).setUint16(
      archive.length - 2,
      comment.length,
      true,
    )

    expect(readZipSummary(withComment)?.entries).toBe(1)
  })

  it('rejects garbage and empty input', () => {
    expect(readZipSummary(new Uint8Array(0))).toBeNull()
    expect(readZipSummary(new Uint8Array(10))).toBeNull()
    expect(readZipSummary(new TextEncoder().encode('not a zip at all, '
      .repeat(20)))).toBeNull()
  })

  it('rejects a truncated archive', () => {
    const archive = createStoredZip({ 'a.txt': 'hello', 'b.txt': 'world' })

    expect(readZipSummary(archive.slice(0, archive.length - 5))).toBeNull()
    expect(readZipSummary(archive.slice(0, 40))).toBeNull()
  })

  it('rejects a central directory that points past the end record', () => {
    const archive = createStoredZip({ 'a.txt': 'hello' })
    const view = new DataView(archive.buffer)

    view.setUint32(archive.length - 22 + 12, 100_000, true)

    expect(readZipSummary(archive)).toBeNull()
  })

  it('rejects an entry count that does not match the directory', () => {
    const lyingCount = createZipWithDeclaredSizes(
      [{ name: 'a.xml', uncompressedSize: 1 }],
      { declaredEntries: 3 },
    )

    expect(readZipSummary(lyingCount)).toBeNull()
  })

  it('rejects a corrupted central entry signature', () => {
    const archive = createZipWithDeclaredSizes([
      { name: 'a.xml', uncompressedSize: 1 },
    ])

    archive[0] = 0

    expect(readZipSummary(archive)).toBeNull()
  })

  it('rejects the zip64 entry count marker', () => {
    const archive = createZipWithDeclaredSizes(
      [{ name: 'a.xml', uncompressedSize: 1 }],
      { declaredEntries: 0xFFFF },
    )

    expect(readZipSummary(archive)).toBeNull()
  })

  it('rejects the zip64 size marker on an entry', () => {
    const archive = createZipWithDeclaredSizes([
      { name: 'a.xml', uncompressedSize: 0xFFFFFFFF },
    ])

    expect(readZipSummary(archive)).toBeNull()
  })

  it('rejects an archive with a zip64 locator', () => {
    const archive = createZipWithDeclaredSizes(
      [{ name: 'a.xml', uncompressedSize: 1 }],
      { withZip64Locator: true },
    )

    expect(readZipSummary(archive)).toBeNull()
  })
})
