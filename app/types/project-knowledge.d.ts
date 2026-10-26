import type { parseError } from 'evlog'
import type { z } from 'zod'
import type {
  KnowledgeCommitResponse,
  KnowledgeItem,
  KnowledgeMode,
} from '#shared/types/project-knowledge.d'
import type {
  knowledgeCommitSchema,
  knowledgeItemCreateSchema,
  knowledgeItemPatchSchema,
  knowledgeNoteCreateSchema,
  knowledgeNoteUpdateSchema,
} from '#shared/utils/project-knowledge-schemas'
import type {
  KnowledgeFileCategory,
  KnowledgePlanSummary,
} from '~/utils/knowledge-upload-plan'

export type ProjectKnowledgeError = ReturnType<typeof parseError>

export type ProjectKnowledgeOutcome<Result>
  = | { ok: true, result: Result }
    | { ok: false, parsed: ProjectKnowledgeError }

export type KnowledgeItemInput = z.input<typeof knowledgeItemCreateSchema>

export type KnowledgeItemPatchInput = z.input<typeof knowledgeItemPatchSchema>

export type KnowledgeNoteCreateInput = z.input<typeof knowledgeNoteCreateSchema>

export type KnowledgeNoteUpdateInput = z.input<typeof knowledgeNoteUpdateSchema>

export type KnowledgeCommitInput = z.input<typeof knowledgeCommitSchema>

export interface KnowledgeModeResult {
  mode: KnowledgeMode | null
}

export interface KnowledgeVersionResult {
  version: number
  packVersion: number | null
}

export type KnowledgeCommitResult = KnowledgeCommitResponse

export interface KnowledgeItemsAddResult extends KnowledgeVersionResult {
  items: KnowledgeItem[]
  skipped: Array<{ index: number, reason: 'duplicate' }>
}

export interface KnowledgeItemTextResult {
  text: string
}

export interface KnowledgeAddItemsOptions {
  commit?: boolean
}

export type KnowledgeUploadPhase
  = | 'idle'
    | 'planning'
    | 'preview'
    | 'running'
    | 'done'
    | 'error'

export type KnowledgeUploadEntryStatus
  = | 'queued'
    | 'extracting'
    | 'uploading-original'
    | 'ready'
    | 'no-text'
    | 'failed'
    | 'skipped-duplicate'

export interface KnowledgeUploadEntry {
  key: string
  name: string
  relativePath: string | null
  category: KnowledgeFileCategory
  sizeBytes: number
  status: KnowledgeUploadEntryStatus
  error: string | null
}

export interface KnowledgeUploadProgress {
  done: number
  total: number
  currentName: string | null
  bytesDone: number
  bytesTotal: number
}

export interface KnowledgeUploadFailure {
  message: string
  why: string | undefined
  status: number
}

export interface KnowledgeUploadSource {
  file: File
  relativePath: string | null
  fileId?: string | null
}

export interface KnowledgePrepareOptions {
  folderId?: string | null
  gitignoreText?: string
}

export interface KnowledgeFolderExistingItem {
  id: string
  relativePath: string
  contentHash: string
  folderId?: string | null
}

export interface KnowledgeFolderSyncInput {
  folderId: string
  incoming: KnowledgeUploadSource[]
  existing: KnowledgeFolderExistingItem[]
  walkedPaths: Iterable<string>
  truncated?: boolean
  gitignoreText?: string
}

export interface KnowledgeSyncSummary {
  added: number
  replaced: number
  removed: number
  unchanged: number
  notices: string[]
  plan: KnowledgePlanSummary
}

export interface KnowledgeSyncResult {
  uploaded: number
  skippedAsDuplicate: number
  kept: number
  removed: number
  unchanged: number
  unchangedUnknown: number
  couldNotRemove: number
  cleanupFailures: number
  notices: string[]
}
