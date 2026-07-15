import type { FileUIPart } from 'ai'
import type { FileMetadata } from '#shared/types/files.d'
import { extractLocalFileStorageKey } from '#shared/utils/files'

const FILE_URL_ORIGIN = 'https://besidka.local'

export interface SafeFileLinks {
  storageKey: string
  openUrl: string
  downloadUrl: string
}

export function getFileUrl(
  storageKey: FileMetadata['storageKey'],
): string {
  return `/files/${storageKey}`
}

export function addFileDownloadQuery(url: string): string {
  const storageKey = extractLocalFileStorageKey(url)

  if (!storageKey) {
    return ''
  }

  return buildSafeFileUrl(
    url,
    getFileUrl(storageKey),
    true,
  ) || ''
}

export function getSafeFileLinks(url: string): SafeFileLinks | null {
  const storageKey = extractLocalFileStorageKey(url)

  if (!storageKey) {
    return null
  }

  const openUrl = buildSafeFileUrl(
    url,
    getFileUrl(storageKey),
    false,
  )
  const downloadUrl = buildSafeFileUrl(
    url,
    getFileDownloadUrl(storageKey),
    true,
  )

  if (!openUrl || !downloadUrl) {
    return null
  }

  return {
    storageKey,
    openUrl,
    downloadUrl,
  }
}

export function getFileDownloadUrl(
  storageKey: FileMetadata['storageKey'],
): string {
  return addFileDownloadQuery(getFileUrl(storageKey))
}

function buildSafeFileUrl(
  sourceUrl: string,
  targetUrl: string,
  download: boolean,
): string | null {
  try {
    const parsedSourceUrl = new URL(sourceUrl, FILE_URL_ORIGIN)
    const parsedTargetUrl = new URL(targetUrl, FILE_URL_ORIGIN)

    parsedTargetUrl.search = parsedSourceUrl.search
    parsedTargetUrl.hash = parsedSourceUrl.hash

    if (download) {
      parsedTargetUrl.searchParams.set('download', '1')
    }

    return (
      `${parsedTargetUrl.pathname}`
      + `${parsedTargetUrl.search}${parsedTargetUrl.hash}`
    )
  } catch {
    return null
  }
}

export function isImageFile(type: FileMetadata['type']): boolean {
  return type.startsWith('image/')
}

export function getFileIcon(type: FileMetadata['type']): string {
  if (type.startsWith('image/'))
    return 'lucide:image'
  if (type.startsWith('video/'))
    return 'lucide:video'
  if (type.startsWith('audio/'))
    return 'lucide:music'
  if (type === 'application/pdf')
    return 'lucide:file-text'
  if (type.startsWith('text/'))
    return 'lucide:file-text'

  return 'lucide:file'
}

export function truncateFilename(
  filename: FileMetadata['name'],
  maxLength: number = 20,
): string {
  if (filename.length <= maxLength) {
    return filename
  }

  const extension = filename.split('.').pop() || ''
  const nameWithoutExt = filename.slice(
    0, filename.length - extension.length - 1,
  )
  const truncated = nameWithoutExt.slice(0, maxLength - extension.length - 4)

  return `${truncated}...${extension}`
}

export function truncateFilenameMiddle(
  filename: FileMetadata['name'],
  maxLength: number = 24,
): string {
  if (filename.length <= maxLength) {
    return filename
  }

  const lastDotIndex = filename.lastIndexOf('.')
  const hasExtension = (
    lastDotIndex > 0
    && lastDotIndex < filename.length - 1
  )
  const extension = hasExtension ? filename.slice(lastDotIndex) : ''
  const nameWithoutExtension = hasExtension
    ? filename.slice(0, lastDotIndex)
    : filename
  const ellipsis = '...'
  const minPrefixLength = 2
  const availableNameLength = (
    maxLength - ellipsis.length - extension.length
  )

  if (availableNameLength >= minPrefixLength) {
    const startLength = Math.ceil(availableNameLength / 2)
    const endLength = Math.floor(availableNameLength / 2)
    const endPart = endLength > 0
      ? nameWithoutExtension.slice(-endLength)
      : ''

    return (
      `${nameWithoutExtension.slice(0, startLength)}`
      + `${ellipsis}${endPart}${extension}`
    )
  }

  const availableWithoutEllipsis = maxLength - ellipsis.length
  const prefixLength = Math.max(1, Math.floor(availableWithoutEllipsis / 2))
  const suffixLength = Math.max(1, availableWithoutEllipsis - prefixLength)

  return (
    `${filename.slice(0, prefixLength)}`
    + `${ellipsis}${filename.slice(-suffixLength)}`
  )
}

export async function convertFileToUIPart(
  fileMetadata: FileMetadata,
): Promise<FileUIPart> {
  return {
    type: 'file',
    mediaType: fileMetadata.type,
    filename: fileMetadata.name,
    url: getFileUrl(fileMetadata.storageKey),
  }
}

export async function convertFilesToUIParts(
  files: FileMetadata[],
): Promise<FileUIPart[]> {
  return Promise.all(files.map(file => convertFileToUIPart(file)))
}
