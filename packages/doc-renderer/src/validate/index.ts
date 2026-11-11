import { validateOoxml } from './ooxml.ts'
import type { OoxmlValidationOptions } from './ooxml.ts'
import { scanPdf } from './pdf.ts'
import { fail } from './result.ts'
import type { ValidatedFormat, ValidationResult } from './result.ts'
import { VALIDATION_LIMITS } from './rules.ts'

export { checkFormula } from './formula.ts'
export type { FormulaCheckResult } from './formula.ts'
export { fail } from './result.ts'
export type {
  ValidatedFormat,
  ValidationFailure,
  ValidationResult,
  ValidationStats,
  ValidationSuccess,
} from './result.ts'
export {
  DOCX_DENIED_FIELDS,
  OOXML_DENIED_PART_PATTERNS,
  PDF_DENIED_NAMES,
  PPTX_ALLOWED_ACTIONS,
  VALIDATION_LIMITS,
  XLSX_FORMULA_FUNCTION_ALLOWLIST,
} from './rules.ts'
export { readZipDirectory, readZipSummary } from './zip.ts'
export type { ZipDirectory, ZipEntry, ZipSummary } from './zip.ts'
export type { OoxmlValidationOptions } from './ooxml.ts'

export const VALIDATED_FORMATS: readonly ValidatedFormat[] = [
  'pdf',
  'docx',
  'pptx',
  'xlsx',
]

/**
 * Rejects anything unsafe in a generated or provider-made PDF/DOCX/PPTX/XLSX
 * and reports the provenance mark it carries. Failure codes are stable
 * strings. Pass the XLSX spec to also require that every formula in the file
 * belongs to a cell the spec declared.
 */
export function validate(
  format: ValidatedFormat,
  bytes: Uint8Array,
  options: OoxmlValidationOptions = {},
): ValidationResult {
  if (bytes.length === 0) {
    return fail('empty', 'File is empty')
  }

  if (bytes.length > VALIDATION_LIMITS.fileBytesMax) {
    return fail(
      'too_large',
      `${bytes.length} bytes, limit ${VALIDATION_LIMITS.fileBytesMax}`,
    )
  }

  if (format === 'pdf') {
    const scanned = scanPdf(bytes)

    if (!scanned.ok) {
      return scanned
    }

    return {
      ok: true,
      stats: { bytes: bytes.length, pages: scanned.result.pages },
      provenance: scanned.result.provenance,
    }
  }

  return validateOoxml(format, bytes, options)
}
