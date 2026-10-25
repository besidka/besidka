import type {
  MemoryCategory,
  MemoryEntry,
  MemorySettingsFields,
} from '#shared/types/memory.d'

export type MemoryEntriesScope = 'account' | 'project' | 'all'

export interface MemoryEntryLimits {
  maxAccountEntries: number
  maxProjectEntries: number
  maxBodyBytes: number
  maxAlwaysInjectedBodyBytes: number
  maxDescriptionChars: number
  maxTitleChars: number
}

export interface MemoryEntryGroup {
  category: MemoryCategory
  entries: MemoryEntry[]
}

export interface MemoryEntryChange {
  reason: 'saved' | 'deleted'
  categoryChanged: boolean
}

export interface MemoryEntriesResponse {
  scope: MemoryEntriesScope
  projectId: string | null
  total: number
  limits: MemoryEntryLimits
  groups: MemoryEntryGroup[]
}

export interface MemoryEntryResponse {
  entry: MemoryEntry
}

export interface MemoryEntrySourceChat {
  id: string
  slug: string
  title: string
}

export interface MemoryEntrySourcesResponse {
  chats: MemoryEntrySourceChat[]
}

export interface MemoryEntryDeleteResponse {
  success: true
}

export interface MemoryResetResponse {
  deleted: number
}

export interface MemoryExportProject {
  id: string
  name: string
  useAccountMemory: boolean
  legacyMemory: string | null
}

export interface MemoryExport {
  version: 1
  exportedAt: string
  settings: MemorySettingsFields
  projects: MemoryExportProject[]
  entries: MemoryEntry[]
}
