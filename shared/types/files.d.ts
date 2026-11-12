import type { ImageOutputOptions } from '@cloudflare/workers-types'
import * as schema from '~~/server/db/schema'

// Formats every provider can receive: images and PDFs natively, text and
// Office files (docx, xlsx, pptx) as text that is extracted when the file is
// stored. The Office types are accepted only while `files.office` is active.
export type AllowedFileFormat
  = | Exclude<ImageOutputOptions['format'], 'avif'>
    | 'application/pdf'
    | 'text/plain'
    | 'text/markdown'
    | 'text/csv'
    | 'text/tab-separated-values'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export type AllowedFileFormats = readonly AllowedFileFormat[]

export type FileMetadata = typeof schema.files.$inferSelect
export type FileSource = FileMetadata['source']

export type FileQuotaTier = 'free' | 'vip'

export interface FilePolicy {
  tier: FileQuotaTier
  maxStorageBytes: number
  maxFilesPerMessage: number
  maxMessageFilesBytes: number
  fileRetentionDays: number | null
  imageTransformLimitTotal: number | null
  imageTransformUsedTotal: number
}

export interface FilePolicyResponse {
  policy: FilePolicy
  globalTransformRemainingMonth: number
}

export interface StorageStats extends FilePolicy {
  used: number
  total: number
  percentage: number
  globalTransformRemainingMonth: number
}
