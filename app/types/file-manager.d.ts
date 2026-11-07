import type { Component } from 'vue'
import type { FileMetadata } from '#shared/types/files.d'

export type FileManagerFile = Pick<
  FileMetadata,
  'id'
  | 'storageKey'
  | 'name'
  | 'size'
  | 'type'
  | 'source'
  | 'expiresAt'
  | 'createdAt'
  | 'originModel'
  | 'generationCost'
>

export type ViewMode = 'grid' | 'list'
export type FileSourceFilter = FileMetadata['source'] | 'project'

interface FileSourceTabBase {
  label: string
  testId: string
}

export interface BuiltInFileSourceTab extends FileSourceTabBase {
  kind: 'built-in'
  id: FileSourceFilter
  requiresImageInput?: boolean
}

export interface ExtraFileSourceTab extends FileSourceTabBase {
  kind: 'extra'
  id: string
  component: Component
  isEnabled?: () => boolean
}

export type FileSourceTab = BuiltInFileSourceTab | ExtraFileSourceTab

export interface FetchFilesResponse {
  files: FileManagerFile[]
  total: number
  offset: number
  limit: number
}

export interface ProjectFileGroupSummary {
  id: string
  name: string
  fileCount: number
  pinned: boolean
  archived: boolean
}

export interface ProjectFileGroup extends ProjectFileGroupSummary {
  files: FileManagerFile[]
  total: number
  serverOffset: number
  isLoading: boolean
  isOpen: boolean
  hasLoaded: boolean
  hasError: boolean
}
