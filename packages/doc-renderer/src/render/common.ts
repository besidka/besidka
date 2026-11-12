import type { ProvenanceInput } from '../provenance.ts'
import { resolveThemeFields } from '../spec/v1.ts'
import type { DocumentSpec, ResolvedTheme } from '../spec/v1.ts'

export interface RenderFonts {
  regular: Uint8Array
  bold: Uint8Array
  italic: Uint8Array
}

export interface RenderOptions {
  provenance?: ProvenanceInput
  fonts?: RenderFonts
  createdAt?: string
}

export interface RenderStats {
  pages?: number
  blocks?: number
  slides?: number
  sheets?: number
  cells?: number
}

export interface RenderResult {
  bytes: Uint8Array
  mediaType: string
  extension: string
  stats: RenderStats
  warnings: string[]
}

export const DEFAULT_PROVENANCE: ProvenanceInput = {
  createdVia: 'chat',
  aiGenerated: true,
}

export const MEDIA_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export const ACCENT_COLORS: Record<ResolvedTheme['accent'], string> = {
  neutral: '374151',
  blue: '1D4ED8',
  green: '15803D',
  orange: 'C2410C',
  violet: '6D28D9',
}

export const ACCENT_TINTS: Record<ResolvedTheme['accent'], string> = {
  neutral: 'E5E7EB',
  blue: 'DBEAFE',
  green: 'DCFCE7',
  orange: 'FFEDD5',
  violet: 'EDE9FE',
}

export function resolveTheme(spec: DocumentSpec): ResolvedTheme {
  return resolveThemeFields(spec.theme)
}

export function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ]
}

export function plainText(runs: ReadonlyArray<{ text: string }>): string {
  return runs.map(run => run.text).join('')
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}
