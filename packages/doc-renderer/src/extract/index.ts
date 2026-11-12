import { OOXML_DENIED_PART_PATTERNS } from '../validate/rules.ts'
import { XmlError } from '../validate/xml.ts'
import {
  ExtractError,
  findEntry,
  openPackage,
  resolveMainPart,
  scanPart,
  utf8Length,
} from './common.ts'
import type { ExtractionOutput, OfficePackage } from './common.ts'
import { extractDocx } from './docx.ts'
import { extractPptx } from './pptx.ts'
import { EXTRACT_FORMATS, EXTRACT_LIMITS } from './types.ts'
import type {
  ExtractFormat,
  ExtractLimits,
  ExtractResult,
  ExtractStats,
} from './types.ts'
import { extractXlsx } from './xlsx.ts'

export {
  EXTRACT_FORMATS,
  EXTRACT_LIMITS,
  EXTRACT_VERSION,
  TRUNCATION_MARKER,
} from './types.ts'
export type {
  ExtractFormat,
  ExtractLimits,
  ExtractResult,
  ExtractStats,
  ExtractStatus,
  TruncationReason,
} from './types.ts'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const COMPOUND_FILE_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0]
const ENCRYPTED_PACKAGE_STREAM = Array.from('EncryptedPackage').flatMap(
  character => [character.charCodeAt(0), 0],
)
const MACRO_PART_PATTERNS = OOXML_DENIED_PART_PATTERNS.filter((denied) => {
  return denied.code === 'ooxml_macro'
})
const MACRO_CONTENT_TYPE_PATTERN = /macroEnabled|vbaProject/i
const TOO_LARGE_CODES: ReadonlySet<string> = new Set([
  'file_too_large',
  'zip_too_many_entries',
  'zip_entry_too_large',
  'zip_total_too_large',
  'zip_ratio',
  'extract_budget_exceeded',
])
const MAIN_PARTS: Record<ExtractFormat, string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}
const MAIN_CONTENT_TYPE_PATTERNS: Record<ExtractFormat, RegExp> = {
  docx: /wordprocessingml\.(?:document|template)\.main\+xml$/,
  xlsx: /spreadsheetml\.(?:sheet|template)\.main\+xml$/,
  pptx: /presentationml\.(?:presentation|template|slideshow)\.main\+xml$/,
}
const EXTRACTORS: Record<
  ExtractFormat,
  (officePackage: OfficePackage) => ExtractionOutput
> = {
  docx: extractDocx,
  xlsx: extractXlsx,
  pptx: extractPptx,
}

function isCompoundFile(bytes: Uint8Array): boolean {
  return COMPOUND_FILE_SIGNATURE.every((value, index) => {
    return bytes[index] === value
  })
}

function containsEncryptedPackage(bytes: Uint8Array): boolean {
  const [first] = ENCRYPTED_PACKAGE_STREAM as [number]
  const last = bytes.length - ENCRYPTED_PACKAGE_STREAM.length

  for (let start = 0; start <= last; start += 1) {
    if (bytes[start] !== first || bytes[start + 1] !== 0) {
      continue
    }

    const isMatch = ENCRYPTED_PACKAGE_STREAM.every((value, offset) => {
      return bytes[start + offset] === value
    })

    if (isMatch) {
      return true
    }
  }

  return false
}

function assertPackageFormat(
  officePackage: OfficePackage,
  format: ExtractFormat,
): void {
  const entry = findEntry(officePackage, CONTENT_TYPES_PART)

  if (!entry) {
    throw new ExtractError(
      'ooxml_malformed',
      'The package has no [Content_Types].xml part',
    )
  }

  if (entry.uncompressedSize > officePackage.limits.contentTypesBytesMax) {
    throw new ExtractError(
      'ooxml_malformed',
      'The [Content_Types].xml part is larger than any real one',
    )
  }

  const mainPart = resolveMainPart(officePackage, MAIN_PARTS[format])
  const mainPartName = `/${mainPart}`.toLowerCase()
  let mainContentType = ''
  let hasMacroContentType = false

  const outcome = scanPart(officePackage, entry, (events) => {
    mainContentType = ''
    hasMacroContentType = false

    for (const event of events) {
      if (event.type !== 'start') {
        continue
      }

      const contentType = event.attributes.ContentType ?? ''

      if (MACRO_CONTENT_TYPE_PATTERN.test(contentType)) {
        hasMacroContentType = true
      }

      const partName = (event.attributes.PartName ?? '').toLowerCase()

      if (event.name === 'Override' && partName === mainPartName) {
        mainContentType = contentType
      }
    }

    return false
  })

  if (outcome.cut) {
    throw new ExtractError(
      'ooxml_malformed',
      'The [Content_Types].xml part could not be read completely',
    )
  }

  const hasMacroPart = [...officePackage.entries.keys()].some((name) => {
    return MACRO_PART_PATTERNS.some(denied => denied.pattern.test(name))
  })

  if (hasMacroContentType || hasMacroPart) {
    throw new ExtractError('ooxml_macro', 'Macro-enabled files are not read')
  }

  const isExpectedType = MAIN_CONTENT_TYPE_PATTERNS[format]
    .test(mainContentType)

  if (!isExpectedType || !findEntry(officePackage, mainPart)) {
    throw new ExtractError(
      'ooxml_format_mismatch',
      `The package is not a ${format} document`,
    )
  }

  officePackage.mainPart = mainPart
}

function failure(
  stats: ExtractStats,
  errorCode: string,
): ExtractResult {
  return {
    status: TOO_LARGE_CODES.has(errorCode) ? 'too_large' : 'failed',
    text: '',
    truncated: false,
    stats,
    errorCode,
  }
}

/**
 * Reads the text of a DOCX, XLSX or PPTX into Markdown of at most
 * `limits.textBytesMax` UTF-8 bytes. It never throws: every problem comes
 * back as a status. Encrypted, legacy (`D0 CF 11 E0`) and macro-enabled files
 * are refused before any part is read, the ZIP limits are applied from the
 * central directory, and only the XML parts that carry text are inflated.
 * Images, charts, shapes, comments, headers, footers and formatting are not
 * included.
 */
export function extractOfficeText(
  bytes: Uint8Array,
  format: ExtractFormat,
  limits: Partial<ExtractLimits> = {},
): ExtractResult {
  const effective: ExtractLimits = { ...EXTRACT_LIMITS, ...limits }
  const stats: ExtractStats = {
    inputBytes: bytes.length,
    entries: 0,
    textBytes: 0,
    truncations: [],
  }

  try {
    if (!EXTRACT_FORMATS.includes(format)) {
      return failure(stats, 'unsupported_format')
    }

    if (bytes.length === 0) {
      return failure(stats, 'empty_file')
    }

    if (bytes.length > effective.fileBytesMax) {
      return failure(stats, 'file_too_large')
    }

    if (isCompoundFile(bytes)) {
      return failure(
        stats,
        containsEncryptedPackage(bytes)
          ? 'ooxml_encrypted'
          : 'legacy_office_format',
      )
    }

    const officePackage = openPackage(bytes, effective, stats)

    assertPackageFormat(officePackage, format)

    const output = EXTRACTORS[format](officePackage)

    if (!output.hasContent) {
      return {
        status: 'empty',
        text: '',
        truncated: false,
        stats: { ...stats, truncations: [] },
        errorCode: 'no_text',
      }
    }

    const text = output.sink.toString()

    stats.textBytes = utf8Length(text)

    return {
      status: 'ready',
      text,
      truncated: stats.truncations.length > 0,
      stats,
    }
  } catch (exception) {
    if (exception instanceof ExtractError || exception instanceof XmlError) {
      return failure(stats, exception.code)
    }

    return failure(stats, 'extract_error')
  }
}
