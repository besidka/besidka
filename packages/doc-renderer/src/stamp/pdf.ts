import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { buildPdfXmp } from '../provenance.ts'
import type { XmpInput } from '../provenance.ts'
import { fail } from '../validate/result.ts'
import type { ValidationFailure } from '../validate/result.ts'

export interface StampPdfOptions extends XmpInput {
  setDocumentTitle?: boolean
}

/**
 * Sets the XMP packet (provenance, and title and language when given) on an
 * existing PDF. pdf-lib rewrites the file, the page content is untouched.
 * Encrypted files are refused. Any XMP already in the file is replaced, not
 * merged: provider-made files rarely carry more than a generator tag.
 */
export async function stampPdf(
  bytes: Uint8Array,
  options: StampPdfOptions,
): Promise<{ ok: true, bytes: Uint8Array } | ValidationFailure> {
  let document: PDFDocument

  try {
    document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: false,
      throwOnInvalidObject: false,
    })
  } catch {
    return fail('pdf_malformed', 'PDF could not be loaded for stamping')
  }

  const packet = buildPdfXmp(options)
  const stream = document.context.stream(new TextEncoder().encode(packet), {
    Type: 'Metadata',
    Subtype: 'XML',
  })

  document.catalog.set(
    PDFName.of('Metadata'),
    document.context.register(stream),
  )

  if (options.language) {
    document.catalog.set(PDFName.of('Lang'), PDFString.of(options.language))
  }

  if (options.setDocumentTitle && options.title) {
    document.setTitle(options.title, { showInWindowTitleBar: true })
  }

  const stamped = await document.save({ useObjectStreams: false })

  return { ok: true, bytes: stamped }
}
