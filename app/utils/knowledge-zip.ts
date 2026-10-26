export interface ZipSummary {
  entries: number
  uncompressedBytes: number
  largestEntryBytes: number
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054B50
const ZIP64_LOCATOR_SIGNATURE = 0x07064B50
const CENTRAL_ENTRY_SIGNATURE = 0x02014B50
const END_OF_CENTRAL_DIRECTORY_BYTES = 22
const ZIP64_LOCATOR_BYTES = 20
const CENTRAL_ENTRY_BYTES = 46
const MAX_COMMENT_BYTES = 0xFFFF
const ZIP64_COUNT_MARKER = 0xFFFF
const ZIP64_SIZE_MARKER = 0xFFFFFFFF

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

/**
 * Reads only the end-of-central-directory record and the central directory,
 * never inflating anything. Returns null for unreadable or zip64 archives, so
 * callers can refuse files whose declared sizes cannot be trusted.
 */
export function readZipSummary(
  bytes: ArrayBuffer | Uint8Array,
): ZipSummary | null {
  const view = bytes instanceof Uint8Array
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes)

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
