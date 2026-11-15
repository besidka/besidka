import { createError } from 'evlog'
import { DOCUMENT_ERROR_CODES } from '#shared/utils/documents'

/**
 * Parses a stored spec object. Returns undefined for text that is not JSON,
 * so a corrupt object is handled like any other invalid spec instead of
 * surfacing a bare SyntaxError as a 500.
 */
export function parseStoredSpec(specText: string): unknown {
  try {
    return JSON.parse(specText)
  } catch {
    return undefined
  }
}

export function createInvalidSpecError() {
  return createError({
    message: 'The document spec is invalid',
    status: 422,
    why: DOCUMENT_ERROR_CODES.specInvalid,
    fix: 'Ask for the document again',
  })
}
