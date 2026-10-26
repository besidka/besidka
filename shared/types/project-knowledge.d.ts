import type {
  knowledgeDecisionModes,
  knowledgeDecisionReasons,
  knowledgeExtractStatuses,
  knowledgeExtractors,
  knowledgeItemKinds,
  knowledgeModes,
  knowledgeTokenFamilies,
} from '#shared/utils/project-knowledge-policy'

export type KnowledgeMode = typeof knowledgeModes[number]

export type KnowledgeDecisionMode = typeof knowledgeDecisionModes[number]

export type KnowledgeDecisionReason = typeof knowledgeDecisionReasons[number]

export type KnowledgeItemKind = typeof knowledgeItemKinds[number]

export type KnowledgeExtractStatus = typeof knowledgeExtractStatuses[number]

export type KnowledgeExtractor = typeof knowledgeExtractors[number]

export type KnowledgeTokenFamily = typeof knowledgeTokenFamilies[number]

export interface KnowledgeCharCounts {
  latinChars: number
  cyrillicChars: number
  otherChars: number
}

export interface KnowledgeMediaCounts {
  images: number
  nativePdfPages: number
}

export interface KnowledgeItem {
  id: string
  projectId: string
  kind: KnowledgeItemKind
  fileId: string | null
  title: string
  description: string | null
  relativePath: string | null
  folderId: string | null
  contentHash: string | null
  mediaType: string | null
  sizeBytes: number | null
  pageCount: number | null
  textBytes: number
  latinChars: number
  cyrillicChars: number
  otherChars: number
  extractStatus: KnowledgeExtractStatus
  extractError: string | null
  extractor: KnowledgeExtractor
  sendAsNativePdf: boolean
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCommitResponse {
  version: number
  packVersion: number | null
  removed: number
  skipped: string[]
}

export interface ProjectKnowledgeSummary {
  projectId: string
  mode: KnowledgeMode
  version: number
  packVersion: number | null
  items: KnowledgeItem[]
  totals: KnowledgeCharCounts & { textBytes: number, items: number }
  accountItems: number
}

export interface KnowledgePackHeader {
  type: 'header'
  version: number
  builtAt: string
  items: Array<{ itemId: string, updatedAt: string, chunks: number }>
}

export interface KnowledgePackLine {
  type: 'chunk'
  itemId: string
  ordinal: number
  breadcrumb: string
  text: string
}

export interface KnowledgeDecisionInput {
  mode: KnowledgeMode
  knowledgeTokens: number
  contextWindow: number | null | undefined
  maxOutputTokens: number | null | undefined
  messageTokens: number
  measuredHistoryTokens: number | null
  estimatedSystemTokens: number
  estimatedHistoryTokens: number
  toolTokens: number
  previousMode?: KnowledgeDecisionMode | null
}

export interface KnowledgeDecision {
  mode: KnowledgeDecisionMode
  reason: KnowledgeDecisionReason
  budgetTokens: number
  contextWindow: number
  contextWindowKnown: boolean
  reservedOutputTokens: number
  requiredTokens: number
  fits: boolean
  notice: 'full-does-not-fit' | null
}

export interface KnowledgeSearchHit {
  itemId: string
  title: string
  relativePath: string | null
  breadcrumb: string
  ordinal: number
  text: string
}

export interface KnowledgeSearchResult {
  hits: KnowledgeSearchHit[]
  operator: 'and' | 'or' | 'none'
  truncated: boolean
  notice: string
}

export interface KnowledgeReadResult {
  itemId: string
  title: string
  fromChunk: number
  chunks: Array<{ ordinal: number, breadcrumb: string, text: string }>
  hasMore: boolean
  notice: string
}
