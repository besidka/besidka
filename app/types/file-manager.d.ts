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
> & {
  documentId?: string | null
  documentAiGenerated?: boolean | null
  textStatus?: FileMetadata['textStatus']
  textBytes?: FileMetadata['textBytes']
  textTruncated?: boolean
  textOmittedMedia?: FileMetadata['textOmittedMedia']
  textOmittedCharts?: FileMetadata['textOmittedCharts']
}

export type AttachedFile = Pick<
  FileMetadata,
  'id' | 'storageKey' | 'name' | 'size' | 'type'
> & {
  textStatus?: FileMetadata['textStatus']
  textBytes?: FileMetadata['textBytes']
  textTruncated?: boolean
  textOmittedMedia?: FileMetadata['textOmittedMedia']
  textOmittedCharts?: FileMetadata['textOmittedCharts']
}

export type ViewMode = 'grid' | 'list'
export type FileSourceFilter = FileMetadata['source'] | 'project'
export type FileKind = 'image' | 'document'
export type FileKindFilter = 'all' | FileKind

export interface FileKindFilterOption {
  id: FileKindFilter
  label: string
  testId: string
}

interface FileSourceTabBase {
  label: string
  testId: string
}

export interface BuiltInFileSourceTab extends FileSourceTabBase {
  kind: 'built-in'
  id: FileSourceFilter
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
