import type { SkillFinding } from '#shared/utils/skills/findings'
import type { SkillFileKind } from '#shared/utils/skills-policy'

export interface SkillImportWorkerRequest {
  id: number
  name: string
  bytes: ArrayBuffer
}

export interface SkillImportWorkerSummary {
  name: string
  description: string
  licenceClass: 'open' | 'custom' | 'none' | 'restricted'
  licenceText: string
  files: Array<{ path: string, bytes: number, kind: SkillFileKind }>
  totalBytes: number
  findings: SkillFinding[]
  findingCounts: Record<string, number>
  warnings: string[]
}

export type SkillImportWorkerResult
  = | { ok: true, summary: SkillImportWorkerSummary }
    | { ok: false, code: string, message: string, path?: string }

export type SkillImportWorkerResponse = SkillImportWorkerResult & {
  id: number
}
