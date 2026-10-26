import type {
  KnowledgeExtractStatus,
  KnowledgeItem,
  KnowledgeTokenFamily,
} from '#shared/types/project-knowledge.d'

export type KnowledgeItemTypeLabel
  = | 'PDF'
    | 'DOCX'
    | 'Sheet'
    | 'Note'
    | 'Text'
    | 'Image'

export type KnowledgeRowStatus = KnowledgeExtractStatus | 'preparing'

export interface KnowledgeItemGroup {
  folderId: string
  name: string
  items: KnowledgeItem[]
}

export type KnowledgeFolderNames = Record<string, string>

export interface KnowledgePreparingRow {
  key: string
  name: string
}

export interface KnowledgeModelContext {
  name: string
  family: KnowledgeTokenFamily
  contextWindow: number | null
  maxOutputTokens: number | null
  acceptsImages: boolean
  acceptsPdf: boolean
  inputPrice: number | null
  cacheReadPrice: number | null
  isCachingAvailable: boolean
}

export interface KnowledgeMeterCopy {
  headline: string
  barLabel: string
  summary: string
  costLine: string | null
  warning: string | null
}

export interface KnowledgeLibraryFile {
  id: string
  storageKey: string
  name: string
  size: number
  type: string
}
