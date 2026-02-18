import type { ImageOutputOptions } from '@cloudflare/workers-types'
import * as schema from '~~/server/db/schema'

// Only file formats supported across ALL AI providers
// such as Gemini, Claude, OpenAI
export type AllowedFileFormat
  = | Exclude<ImageOutputOptions['format'], 'avif'>
    | 'application/pdf'
    | 'text/plain'

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
