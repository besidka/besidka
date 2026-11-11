export type ContainerDocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx'

export type ContainerDocumentProvenance = 'ai' | 'channel-only' | 'missing'

export type ContainerDocumentCheck
  = | {
    ok: true
    bytes: Uint8Array
    provenance: ContainerDocumentProvenance
  }
  | { ok: false, code: string }

export interface CheckContainerDocumentInput {
  format: ContainerDocumentFormat
  bytes: Uint8Array
  model: string
}

/**
 * The single place a provider-made PDF or Office file is validated and given
 * provenance before Besidka stores it. It is a seam over
 * `@besidka/doc-renderer`: `validate()` rejects anything unsafe (structural
 * parse, not a byte grep) and `stampDocument()` adds the AI provenance mark
 * without re-rendering. A file that validates but cannot be stamped is kept
 * unchanged and reported as `missing`, so the gap is recorded and not hidden.
 */
export async function checkContainerDocument(
  input: CheckContainerDocumentInput,
): Promise<ContainerDocumentCheck> {
  const { validate } = await import('@besidka/doc-renderer/validate')
  const validation = validate(input.format, input.bytes)

  if (!validation.ok) {
    return { ok: false, code: validation.code }
  }

  const { stampDocument } = await import('@besidka/doc-renderer/stamp')
  const stamped = await stampDocument(input.format, input.bytes, {
    model: input.model,
    createdVia: 'code-execution',
  })

  if (!stamped.ok) {
    return {
      ok: true,
      bytes: input.bytes,
      provenance: validation.provenance,
    }
  }

  return { ok: true, bytes: stamped.bytes, provenance: stamped.provenance }
}
