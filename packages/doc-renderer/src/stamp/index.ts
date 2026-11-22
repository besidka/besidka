import type { Provenance } from '../provenance.ts'
import { validate } from '../validate/index.ts'
import { fail } from '../validate/result.ts'
import type { ValidatedFormat, ValidationFailure } from '../validate/result.ts'
import { stampOoxml } from './ooxml.ts'
import type { StampOoxmlOptions } from './ooxml.ts'
import { stampPdf } from './pdf.ts'

export { PINNED_DOCUMENT_DATE, stampOoxml } from './ooxml.ts'
export type { StampOoxmlOptions } from './ooxml.ts'
export { stampPdf } from './pdf.ts'
export type { StampPdfOptions } from './pdf.ts'

export type StampDocumentResult
  = | { ok: true, bytes: Uint8Array, stamped: boolean, provenance: Provenance }
    | ValidationFailure

/**
 * Adds provenance to a provider-made file (D-7, D-8) without re-rendering.
 * The file is validated first; one that already carries the AI mark comes
 * back byte-identical. Otherwise the result is re-validated, so a stamp that
 * produced something unsafe is never returned.
 */
export async function stampDocument(
  format: ValidatedFormat,
  bytes: Uint8Array,
  options: StampOoxmlOptions,
): Promise<StampDocumentResult> {
  const before = validate(format, bytes)

  if (!before.ok) {
    return before
  }

  const wantsAiMark = options.aiGenerated !== false

  if (wantsAiMark && before.provenance === 'ai') {
    return { ok: true, bytes, stamped: false, provenance: 'ai' }
  }

  const stamped = format === 'pdf'
    ? await stampPdf(bytes, options)
    : stampOoxml(bytes, options)

  if (!stamped.ok) {
    return stamped
  }

  const after = validate(format, stamped.bytes)

  if (!after.ok) {
    return after
  }

  const expected: Provenance = wantsAiMark ? 'ai' : 'channel-only'

  if (after.provenance !== expected) {
    return fail('stamp_failed', `Stamped file reports provenance ${after.provenance}`)
  }

  return {
    ok: true,
    bytes: stamped.bytes,
    stamped: true,
    provenance: after.provenance,
  }
}
