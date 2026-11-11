import { VALIDATION_LIMITS } from './rules.ts'

export interface ZipSummary {
  entries: number
  uncompressedBytes: number
  largestEntryBytes: number
}

export interface ZipEntry {
  name: string
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dataOffset: number
}

export interface ZipDirectory {
  entries: ZipEntry[]
  totalUncompressedBytes: number
}

export type ZipDirectoryResult
  = | { ok: true, directory: ZipDirectory }
    | { ok: false, code: string, detail: string }

interface CentralDirectoryLocation {
  view: DataView
  endOffset: number
  declaredEntries: number
  directoryOffset: number
  directoryEnd: number
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054B50
const ZIP64_LOCATOR_SIGNATURE = 0x07064B50
const CENTRAL_ENTRY_SIGNATURE = 0x02014B50
const LOCAL_HEADER_SIGNATURE = 0x04034B50
const END_OF_CENTRAL_DIRECTORY_BYTES = 22
const ZIP64_LOCATOR_BYTES = 20
const CENTRAL_ENTRY_BYTES = 46
const LOCAL_HEADER_BYTES = 30
const MAX_COMMENT_BYTES = 0xFFFF
const ZIP64_COUNT_MARKER = 0xFFFF
const ZIP64_SIZE_MARKER = 0xFFFFFFFF
const FLAG_ENCRYPTED = 0x0001
const FLAG_STRONG_ENCRYPTION = 0x0040
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

function toView(bytes: ArrayBuffer | Uint8Array): DataView {
  return bytes instanceof Uint8Array
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes)
}

function findEndOfCentralDirectory(view: DataView): number {
  const lastOffset = view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES
  const firstOffset = Math.max(0, lastOffset - MAX_COMMENT_BYTES)

  for (let offset = lastOffset; offset >= firstOffset; offset -= 1) {
    if (
      view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return offset
    }
  }

  return -1
}

function hasZip64Locator(view: DataView, endOffset: number): boolean {
  const locatorOffset = endOffset - ZIP64_LOCATOR_BYTES

  return locatorOffset >= 0
    && view.getUint32(locatorOffset, true) === ZIP64_LOCATOR_SIGNATURE
}

function locateCentralDirectory(
  bytes: ArrayBuffer | Uint8Array,
): CentralDirectoryLocation | null {
  const view = toView(bytes)

  if (view.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) {
    return null
  }

  const endOffset = findEndOfCentralDirectory(view)

  if (endOffset < 0 || hasZip64Locator(view, endOffset)) {
    return null
  }

  const declaredEntries = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)

  if (
    declaredEntries === ZIP64_COUNT_MARKER
    || directorySize === ZIP64_SIZE_MARKER
    || directoryOffset === ZIP64_SIZE_MARKER
  ) {
    return null
  }

  const directoryEnd = directoryOffset + directorySize

  if (directoryEnd > endOffset) {
    return null
  }

  return { view, endOffset, declaredEntries, directoryOffset, directoryEnd }
}

/**
 * Reads only the end-of-central-directory record and the central directory,
 * never inflating anything. Returns null for unreadable or zip64 archives, so
 * callers can refuse files whose declared sizes cannot be trusted.
 */
export function readZipSummary(
  bytes: ArrayBuffer | Uint8Array,
): ZipSummary | null {
  const location = locateCentralDirectory(bytes)

  if (!location) {
    return null
  }

  const { view, declaredEntries, directoryOffset, directoryEnd } = location
  let offset = directoryOffset
  let uncompressedBytes = 0
  let largestEntryBytes = 0

  for (let index = 0; index < declaredEntries; index += 1) {
    if (offset + CENTRAL_ENTRY_BYTES > directoryEnd) {
      return null
    }

    if (view.getUint32(offset, true) !== CENTRAL_ENTRY_SIGNATURE) {
      return null
    }

    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)

    if (
      compressedSize === ZIP64_SIZE_MARKER
      || uncompressedSize === ZIP64_SIZE_MARKER
    ) {
      return null
    }

    uncompressedBytes += uncompressedSize
    largestEntryBytes = Math.max(largestEntryBytes, uncompressedSize)
    offset += CENTRAL_ENTRY_BYTES + nameLength + extraLength + commentLength
  }

  if (offset > directoryEnd) {
    return null
  }

  return { entries: declaredEntries, uncompressedBytes, largestEntryBytes }
}

const fatalDecoder = new TextDecoder('utf-8', { fatal: true })

function decodeEntryName(
  bytes: Uint8Array,
  start: number,
  length: number,
): string | null {
  try {
    return fatalDecoder.decode(bytes.subarray(start, start + length))
  } catch {
    return null
  }
}

function isUnsafeEntryName(name: string): string | null {
  if (name.length === 0 || name.length > 512) {
    return 'empty or overlong name'
  }

  if (name.includes('\\')) {
    return 'backslash in name'
  }

  if (name.includes('\0')) {
    return 'NUL in name'
  }

  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    return 'absolute path'
  }

  if (name.split('/').some(segment => segment === '..')) {
    return 'path traversal'
  }

  return null
}

/**
 * Validates the central directory against the hard limits and returns every
 * entry with its data offset. Nothing is inflated here: declared sizes are a
 * pre-filter only, the streaming byte cap in `inflateEntry` is the real bound.
 */
export function readZipDirectory(bytes: Uint8Array): ZipDirectoryResult {
  const startsWithLocalHeader = bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4B
    && bytes[2] === 0x03
    && bytes[3] === 0x04

  if (!startsWithLocalHeader) {
    return { ok: false, code: 'zip_invalid', detail: 'Missing PK signature' }
  }

  const view = toView(bytes)

  if (view.byteLength >= END_OF_CENTRAL_DIRECTORY_BYTES) {
    const endOffset = findEndOfCentralDirectory(view)

    if (endOffset >= 0 && hasZip64Locator(view, endOffset)) {
      return { ok: false, code: 'zip64', detail: 'ZIP64 is not supported' }
    }

    if (endOffset >= 0) {
      const count = view.getUint16(endOffset + 10, true)
      const size = view.getUint32(endOffset + 12, true)
      const offset = view.getUint32(endOffset + 16, true)

      if (
        count === ZIP64_COUNT_MARKER
        || size === ZIP64_SIZE_MARKER
        || offset === ZIP64_SIZE_MARKER
      ) {
        return { ok: false, code: 'zip64', detail: 'ZIP64 is not supported' }
      }
    }
  }

  const location = locateCentralDirectory(bytes)

  if (!location) {
    return {
      ok: false,
      code: 'zip_invalid',
      detail: 'Central directory not found',
    }
  }

  const { declaredEntries, directoryOffset, directoryEnd, endOffset } = location
  const commentLength = location.view.getUint16(endOffset + 20, true)

  if (
    endOffset + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength !== bytes.length
    || directoryEnd !== endOffset
  ) {
    return {
      ok: false,
      code: 'zip_invalid',
      detail: 'Data after the central directory or a forged end record',
    }
  }

  if (declaredEntries > VALIDATION_LIMITS.zipEntriesMax) {
    return {
      ok: false,
      code: 'zip_too_many_entries',
      detail: `${declaredEntries} entries, limit ${VALIDATION_LIMITS.zipEntriesMax}`,
    }
  }

  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let offset = directoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < declaredEntries; index += 1) {
    if (
      offset + CENTRAL_ENTRY_BYTES > directoryEnd
      || view.getUint32(offset, true) !== CENTRAL_ENTRY_SIGNATURE
    ) {
      return {
        ok: false,
        code: 'zip_invalid',
        detail: 'Malformed central directory',
      }
    }

    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const nextOffset
      = offset + CENTRAL_ENTRY_BYTES + nameLength + extraLength + commentLength

    if (nextOffset > directoryEnd) {
      return {
        ok: false,
        code: 'zip_invalid',
        detail: 'Central directory entry overruns the directory',
      }
    }

    if (
      compressedSize === ZIP64_SIZE_MARKER
      || uncompressedSize === ZIP64_SIZE_MARKER
      || localHeaderOffset === ZIP64_SIZE_MARKER
    ) {
      return { ok: false, code: 'zip64', detail: 'ZIP64 is not supported' }
    }

    const name = decodeEntryName(
      bytes,
      offset + CENTRAL_ENTRY_BYTES,
      nameLength,
    )

    if (name === null) {
      return {
        ok: false,
        code: 'zip_unsafe_path',
        detail: 'Entry name is not valid UTF-8',
      }
    }

    const unsafeReason = isUnsafeEntryName(name)

    if (unsafeReason) {
      return {
        ok: false,
        code: 'zip_unsafe_path',
        detail: `${unsafeReason}: ${name.slice(0, 80)}`,
      }
    }

    const nameKey = name.toLowerCase()

    if (names.has(nameKey)) {
      return {
        ok: false,
        code: 'zip_duplicate_entry',
        detail: `Duplicate entry: ${name.slice(0, 80)}`,
      }
    }

    names.add(nameKey)

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) {
      return {
        ok: false,
        code: 'zip_encrypted',
        detail: `Encrypted entry: ${name.slice(0, 80)}`,
      }
    }

    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      return {
        ok: false,
        code: 'zip_method',
        detail: `Unsupported compression method ${method}`,
      }
    }

    if (uncompressedSize > VALIDATION_LIMITS.zipEntryBytesMax) {
      return {
        ok: false,
        code: 'zip_entry_too_large',
        detail: `Entry ${name.slice(0, 80)} declares ${uncompressedSize} bytes`,
      }
    }

    totalUncompressedBytes += uncompressedSize

    if (totalUncompressedBytes > VALIDATION_LIMITS.zipTotalBytesMax) {
      return {
        ok: false,
        code: 'zip_total_too_large',
        detail: `Archive declares more than ${VALIDATION_LIMITS.zipTotalBytesMax} bytes`,
      }
    }

    const isRatioChecked
      = uncompressedSize >= VALIDATION_LIMITS.zipRatioMinBytes

    if (
      isRatioChecked
      && (
        compressedSize === 0
        || uncompressedSize / compressedSize > VALIDATION_LIMITS.zipRatioMax
      )
    ) {
      return {
        ok: false,
        code: 'zip_ratio',
        detail: `Entry ${name.slice(0, 80)} exceeds ${VALIDATION_LIMITS.zipRatioMax}:1`,
      }
    }

    if (method === METHOD_STORED && compressedSize !== uncompressedSize) {
      return {
        ok: false,
        code: 'zip_size_mismatch',
        detail: `Stored entry ${name.slice(0, 80)} has different sizes`,
      }
    }

    if (
      localHeaderOffset + LOCAL_HEADER_BYTES > location.directoryOffset
      || view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE
    ) {
      return {
        ok: false,
        code: 'zip_invalid',
        detail: `Bad local header for ${name.slice(0, 80)}`,
      }
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset
      + LOCAL_HEADER_BYTES
      + localNameLength
      + localExtraLength

    if (
      view.getUint16(localHeaderOffset + 8, true) !== method
      || localNameLength !== nameLength
      || decodeEntryName(
        bytes,
        localHeaderOffset + LOCAL_HEADER_BYTES,
        localNameLength,
      ) !== name
    ) {
      return {
        ok: false,
        code: 'zip_invalid',
        detail: `Local header name differs for ${name.slice(0, 80)}`,
      }
    }

    if (dataOffset + compressedSize > location.directoryOffset) {
      return {
        ok: false,
        code: 'zip_invalid',
        detail: `Entry data overruns the archive: ${name.slice(0, 80)}`,
      }
    }

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
    })

    offset = nextOffset
  }

  if (offset !== directoryEnd) {
    return {
      ok: false,
      code: 'zip_invalid',
      detail: 'Central directory has more records than declared',
    }
  }

  return { ok: true, directory: { entries, totalUncompressedBytes } }
}
