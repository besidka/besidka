export const ARTIFACT_KINDS = [
  'html',
  'react',
  'svg',
  'mermaid',
  'markdown',
] as const

export const ARTIFACT_CREATED_VIA = ['chat', 'mcp', 'research'] as const

export const ARTIFACT_VERSION_CREATED_BY = ['model', 'user', 'mcp'] as const

export const ARTIFACT_SHARE_CREATED_VIA = ['ui', 'mcp'] as const

export const ARTIFACT_REPORT_REASONS = [
  'illegal',
  'copyright',
  'privacy',
  'harmful',
  'other',
  'csam',
  'terrorism',
  'threat-to-life',
  'phishing',
] as const

export const ARTIFACT_REPORT_STATUSES = ['open', 'actioned', 'rejected'] as const

export const ARTIFACT_REPORT_PRIORITIES = ['normal', 'urgent'] as const

export const ARTIFACT_REPORT_DECISIONS = [
  'removed',
  'restricted',
  'no-action',
] as const

export const ARTIFACT_VERSION_MAX_BYTES = 512 * 1024
export const ARTIFACT_MAX_VERSIONS = 50
export const ARTIFACT_USER_QUOTA_BYTES = 25 * 1024 * 1024
export const ARTIFACT_TITLE_MAX = 120
export const ARTIFACT_STORAGE_MAX_BYTES = 100 * 1024
export const ARTIFACT_STORAGE_MAX_KEYS = 64
export const ARTIFACT_BULK_DELETE_MAX = 50

export const ARTIFACT_DATA_PART_TYPE = 'data-artifact'

export type ArtifactKind = typeof ARTIFACT_KINDS[number]
export type ArtifactCreatedVia = typeof ARTIFACT_CREATED_VIA[number]
export type ArtifactVersionCreatedBy
  = typeof ARTIFACT_VERSION_CREATED_BY[number]

export interface ArtifactSummary {
  id: string
  title: string
  kind: ArtifactKind
  currentVersion: number
  versionCount: number
  updatedAt: string
  originChatSlug: string | null
  createdVia: ArtifactCreatedVia
  activeShareCount: number
  takenDown: boolean
}

export interface ArtifactVersionSummary {
  version: number
  sizeBytes: number
  createdBy: ArtifactVersionCreatedBy
  createdAt: string
}

export interface ArtifactDetail extends ArtifactSummary {
  totalBytes: number
  createdAt: string
  versions: ArtifactVersionSummary[]
}

export interface ArtifactVersionContent {
  artifactId: string
  kind: ArtifactKind
  title: string
  version: number
  content: string
  sizeBytes: number
  createdAt: string
}

export interface DataArtifactPartData {
  artifactId: string
  version: number
  kind: ArtifactKind
  title: string
}

export interface DataArtifactPart {
  type: typeof ARTIFACT_DATA_PART_TYPE
  data: DataArtifactPartData
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string'
    && (ARTIFACT_KINDS as readonly string[]).includes(value)
}

export function isDataArtifactPart(part: unknown): part is DataArtifactPart {
  if (typeof part !== 'object' || part === null) {
    return false
  }

  const { type, data } = part as { type?: unknown, data?: unknown }

  if (type !== ARTIFACT_DATA_PART_TYPE) {
    return false
  }

  if (typeof data !== 'object' || data === null) {
    return false
  }

  const candidate = data as Record<string, unknown>

  return typeof candidate.artifactId === 'string'
    && Number.isSafeInteger(candidate.version)
    && isArtifactKind(candidate.kind)
    && typeof candidate.title === 'string'
}

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
