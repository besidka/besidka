import type {
  SkillCreatedVia,
  SkillFileKind,
  SkillLicenseClass,
  SkillSourceKind,
  SkillStatus,
  SkillVersionOrigin,
} from '#shared/utils/skills-policy'
import type { SkillFinding } from '#shared/utils/skills/findings'
import type { SkillChangedSetting } from '#shared/utils/skills/update-changes'
import type {
  SkillFileDiff,
  SkillFileDiffStatus,
} from '#shared/utils/skills/diff'

export interface SkillSummary {
  id: string
  name: string
  description: string
  enabled: boolean
  modelInvocable: boolean
  command: string | null
  slashCommand: boolean
  argumentHint: string | null
  status: SkillStatus
  licenseClass: SkillLicenseClass
  licenseField: string | null
  sourceKind: SkillSourceKind
  sourceUrl: string | null
  sourceRef: string | null
  sourcePath: string | null
  sourceVersion: string | null
  metadataVersion: string | null
  updateAvailable: { label: string, ref: string } | null
  highlightCount: number
  currentVersion: number
  pendingVersion: number | null
  filesCount: number
  bytes: number
  allowScripts: boolean
  hasScripts: boolean
  scriptsProviderName: string | null
  scriptsUploaded: boolean
  createdVia: SkillCreatedVia
  createdByClientId: string | null
  createdAt: string
  updatedAt: string
}

export interface SkillsListResponse {
  skills: SkillSummary[]
  counts: {
    sources: { all: number, created: number, imported: number, apps: number }
  }
}

export interface SkillVersionSummary {
  version: number
  origin: SkillVersionOrigin
  note: string | null
  sha256: string
  filesCount: number
  bytes: number
  licenseClass: SkillLicenseClass
  findings: Record<string, number> | null
  sourceKind: SkillSourceKind | null
  sourceUrl: string | null
  sourceRef: string | null
  sourcePath: string | null
  sourceVersion: string | null
  createdByClientId: string | null
  createdAt: string
  isCurrent: boolean
  isPending: boolean
}

export interface SkillFileSummary {
  path: string
  bytes: number
  kind: SkillFileKind
  sha256: string
  editable: boolean
}

export interface SkillDetail extends SkillSummary {
  license: {
    class: SkillLicenseClass
    field: string | null
    fileSha256: string | null
    filesLocked: boolean
  }
  compatibility: string | null
  metadata: Record<string, string> | null
  allowedTools: string[] | null
  files: SkillFileSummary[]
  currentVersionInfo: SkillVersionSummary | null
  pendingVersionInfo: SkillVersionSummary | null
}

export interface SkillVersionsResponse {
  current: number
  pending: number | null
  versions: SkillVersionSummary[]
}

export interface SkillFileTextResponse extends SkillFileSummary {
  version: number
  text: string
}

export interface SkillVersionChanges {
  newFindings: SkillFinding[]
  newHosts: string[]
  changedSettings: SkillChangedSetting[]
  newScripts: string[]
  isPartial: boolean
}

export interface SkillVersionDiffResponse {
  from: SkillVersionSummary
  to: SkillVersionSummary
  changes: SkillVersionChanges | null
  diff: {
    files: SkillFileDiff[]
    added: number
    removed: number
    unchanged: number
    truncated: boolean
  }
  skipped: Array<{ path: string, status: SkillFileDiffStatus }>
  license: {
    changed: boolean
    before: { class: SkillLicenseClass, fileSha256: string | null }
    after: { class: SkillLicenseClass, fileSha256: string | null }
  }
}

export interface SkillImportRelease {
  tag: string | null
  isLatestRelease: boolean
  latestTag: string | null
  defaultBranch: string | null
  channel: 'release' | 'branch'
  switchable: boolean
}

export interface SkillImportInstalled {
  kind: 'same-source' | 'same-name'
  skillId: string
  name: string
  sourceLabel: string | null
  isUpToDate: boolean
}

export interface SkillImportPreview {
  stageId: string
  source: string
  sourceVersion: string
  sourceUrl: string | null
  sourceRef: string | null
  sourcePath: string | null
  release: SkillImportRelease | null
  installed: SkillImportInstalled | null
  expiresAt: number
  skill: {
    name: string
    description: string
    license: string | null
    compatibility: string | null
    metadata: Record<string, string> | null
    allowedTools: string[] | null
    modelInvocable: boolean
    argumentHint: string | null
  }
  files: Array<{ path: string, bytes: number, kind: SkillFileKind }>
  skillMd: string
  findings: SkillFinding[]
  findingCounts: Record<string, number>
  warnings: string[]
  license: {
    class: SkillLicenseClass
    text: string
    matched: string[]
    file: string | null
    spdx: string | null
    licenseText: string | null
    licenseField: string | null
    fromRepositoryRoot: boolean
  }
  requiresLicenseAcknowledgement: boolean
}

export interface SkillGithubPick {
  pick: {
    owner: string
    repo: string
    ref: string
    sha: string
    total: number
    truncated: boolean
    max: number
    candidates: Array<{ path: string, name: string }>
  }
}

export type SkillImportPreviewResponse = SkillImportPreview | SkillGithubPick

export interface SkillImportCommitResponse {
  kind: 'created' | 'pending'
  id: string
  name: string
  version: number
  pendingVersion?: number
  sha256?: string
  licenseClass: SkillLicenseClass
  filesCount: number
}
