import type { Provenance } from '../provenance.ts'

export type ValidatedFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx'

export interface ValidationStats {
  bytes: number
  entries?: number
  pages?: number
  slides?: number
  sheets?: number
  cells?: number
}

export interface ValidationSuccess {
  ok: true
  stats: ValidationStats
  provenance: Provenance
}

export interface ValidationFailure {
  ok: false
  code: string
  detail: string
}

export type ValidationResult = ValidationSuccess | ValidationFailure

export function fail(code: string, detail: string): ValidationFailure {
  return { ok: false, code, detail }
}
