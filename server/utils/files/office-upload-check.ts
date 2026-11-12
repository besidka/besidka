import { createError } from 'evlog'
import { readZipDirectory, readZipSummary } from '@besidka/doc-renderer/zip'
import type { ZipLimits } from '@besidka/doc-renderer/zip'
import {
  OFFICE_FORMAT_LABELS,
  OFFICE_SAVE_AS_FIX,
  OFFICE_UPLOAD_MAX_BYTES,
  getOfficeExtensionKind,
} from '#shared/utils/office-files'
import type { OfficeFormat } from '#shared/utils/office-files'
import { formatFileSize } from '#shared/utils/files'

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0]

/**
 * The bounds the text extractor applies (`EXTRACT_LIMITS` in
 * `@besidka/doc-renderer/extract`), not the tighter ones for generated
 * documents: a real spreadsheet or deck can pack well past 100:1, and a file
 * the extractor would read should not be refused at the door. A spec pins the
 * two together.
 */
export const OFFICE_UPLOAD_ZIP_LIMITS: ZipLimits = {
  entriesMax: 5000,
  entryBytesMax: 50 * 1024 * 1024,
  totalBytesMax: 150 * 1024 * 1024,
  ratioMax: 1000,
  ratioMinBytes: 1024 * 1024,
}

export const OFFICE_MAIN_PARTS: Record<OfficeFormat, string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

export function createOfficeRejection(why: string, fix: string) {
  return createError({
    message: 'This Office file cannot be attached',
    status: 400,
    why,
    fix,
  })
}

/**
 * Throws the 400 for a legacy (.doc, .xls, .ppt) or macro-enabled extension.
 * The check runs on the file name alone, before the body is read.
 */
export function assertSupportedOfficeExtension(fileName: string): void {
  const kind = getOfficeExtensionKind(fileName)

  if (kind === 'legacy') {
    throw createOfficeRejection(
      'Legacy Word, Excel and PowerPoint files (.doc, .xls, .ppt) are not supported.',
      OFFICE_SAVE_AS_FIX,
    )
  }

  if (kind === 'macro') {
    throw createOfficeRejection(
      'Macro-enabled Office files (.docm, .xlsm, .pptm) are not supported.',
      OFFICE_SAVE_AS_FIX,
    )
  }
}

export function assertOfficeContentLength(
  contentLength: number | null,
): void {
  if (contentLength !== null && contentLength > OFFICE_UPLOAD_MAX_BYTES) {
    throw createOfficeFileTooLargeError()
  }
}

export function createOfficeFileTooLargeError() {
  return createOfficeRejection(
    `Office files are limited to ${formatFileSize(OFFICE_UPLOAD_MAX_BYTES)}.`,
    'Remove large images or sheets from the file, or send a smaller file.',
  )
}

/**
 * Structural checks for an uploaded Office file, in order: the extension, the
 * ZIP magic bytes (a compound file is a legacy or password-protected file),
 * the central directory bounds, the format's main part, and the size cap.
 * Nothing is inflated here. Generated documents go through the renderer's
 * `validate()` instead; an upload has no spec to check, so this is the
 * structural gate that runs before the bytes are stored.
 */
export function assertOfficeUploadBytes(
  fileName: string,
  format: OfficeFormat,
  bytes: Uint8Array,
): void {
  assertSupportedOfficeExtension(fileName)

  if (getOfficeExtensionKind(fileName) !== 'office') {
    throw createOfficeRejection(
      `The file name must end in .${format}.`,
      OFFICE_SAVE_AS_FIX,
    )
  }

  const label = OFFICE_FORMAT_LABELS[format]

  if (startsWith(bytes, COMPOUND_FILE_SIGNATURE)) {
    throw createOfficeRejection(
      `This is not a ${label} .${format} file. It is a legacy or password-protected Office file.`,
      'Remove the password, save the file as .docx, .xlsx or .pptx and attach that.',
    )
  }

  if (!startsWith(bytes, ZIP_SIGNATURE)) {
    throw createOfficeRejection(
      `The content is not a ${label} .${format} file.`,
      'Open the file in Office, save it as .docx, .xlsx or .pptx and attach that.',
    )
  }

  const summary = readZipSummary(bytes)

  if (
    !summary
    || summary.entries > OFFICE_UPLOAD_ZIP_LIMITS.entriesMax
    || summary.uncompressedBytes > OFFICE_UPLOAD_ZIP_LIMITS.totalBytesMax
    || summary.largestEntryBytes > OFFICE_UPLOAD_ZIP_LIMITS.entryBytesMax
  ) {
    throw createOfficeRejection(
      `The ${label} file is damaged or larger than it can be safely read.`,
      'Open the file in Office, save a fresh copy and attach that.',
    )
  }

  const directory = readZipDirectory(bytes, OFFICE_UPLOAD_ZIP_LIMITS)

  if (!directory.ok) {
    throw createOfficeRejection(
      directory.code === 'zip_encrypted'
        ? 'The file is password-protected.'
        : `The ${label} file is damaged or unsafe to read (${directory.code}).`,
      'Remove the password or save a fresh copy, then attach it again.',
    )
  }

  const mainPart = OFFICE_MAIN_PARTS[format]
  const hasMainPart = directory.directory.entries.some((entry) => {
    return entry.name === mainPart
  })

  if (!hasMainPart) {
    throw createOfficeRejection(
      `The file does not contain a ${label} document (${mainPart} is missing).`,
      'Check the file extension matches the file, or save it again from Office.',
    )
  }

  if (bytes.byteLength > OFFICE_UPLOAD_MAX_BYTES) {
    throw createOfficeFileTooLargeError()
  }
}
