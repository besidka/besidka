import type {
  KnowledgeExtractor,
  KnowledgeUploadExtractStatus,
} from '#shared/types/project-knowledge.d'

export interface KnowledgeWorkerRequest {
  id: number
  name: string
  bytes: ArrayBuffer
}

export interface KnowledgeWorkerResult {
  extractor: KnowledgeExtractor
  extractStatus: KnowledgeUploadExtractStatus
  extractError: string | null
  text: string
  html?: string
  pageCount: number | null
  contentHash: string
}

export interface KnowledgeWorkerResponse extends KnowledgeWorkerResult {
  id: number
}

export interface KnowledgeExtractionResult {
  extractor: KnowledgeExtractor
  extractStatus: KnowledgeUploadExtractStatus
  extractError: string | null
  text: string
  pageCount: number | null
  contentHash: string
  mediaType: string
  sizeBytes: number
  needsOriginalUpload: boolean
}

export interface KnowledgeExtractOptions {
  signal?: AbortSignal
}
