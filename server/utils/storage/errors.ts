import { createError } from 'evlog'
import { formatFileSize } from '#shared/utils/files'

export const STORAGE_FULL_CODE = 'storage_full'
export const STORAGE_FULL_MESSAGE = 'Storage is full'
export const STORAGE_PAGE_PATH = '/profile/storage'

export interface StorageFullErrorInput {
  usedBytes: number
  totalBytes: number
}

export function createStorageFullError(input: StorageFullErrorInput) {
  return createError({
    message: STORAGE_FULL_MESSAGE,
    status: 413,
    code: STORAGE_FULL_CODE,
    why: `${formatFileSize(input.usedBytes)} of `
      + `${formatFileSize(input.totalBytes)} used`,
    fix: 'Free space on the Storage page',
    link: STORAGE_PAGE_PATH,
  })
}

export function isStorageFullError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false
  }

  return (exception as { code?: unknown }).code === STORAGE_FULL_CODE
}

export function describeStorageFullForModel(exception: unknown): string {
  const { why } = exception as { why?: string }

  return `${STORAGE_FULL_MESSAGE}. ${why ? `${why}. ` : ''}`
    + 'Tell the user to free space on the Storage page of their Besidka '
    + 'settings, then ask again.'
}
