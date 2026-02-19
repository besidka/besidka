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
>

export type ViewMode = 'grid' | 'list'
