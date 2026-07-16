export const HIDDEN_FILE_MEDIA_TYPE = 'application/x-besidka-hidden-file'

export function isHiddenFilePart(
  part: { type: string, mediaType?: string },
): boolean {
  return part.type === 'file' && part.mediaType === HIDDEN_FILE_MEDIA_TYPE
}

const GENERATED_FILE_QUERY_PARAM = 'generated'

export function markUrlAsGeneratedFile(url: string): string {
  try {
    const target = new URL(url, 'https://besidka.local')

    target.searchParams.set(GENERATED_FILE_QUERY_PARAM, '1')

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return url
  }
}

export function isGeneratedFilePart(
  part: { type: string, url?: string },
): boolean {
  if (part.type !== 'file' || typeof part.url !== 'string') {
    return false
  }

  try {
    const url = new URL(part.url, 'https://besidka.local')

    return url.searchParams.get(GENERATED_FILE_QUERY_PARAM) === '1'
  } catch {
    return false
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`

  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`
}

const safeStorageKeyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,158}[A-Za-z0-9_-])?$/

export function isSafeFileStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && !value.includes('..')
    && safeStorageKeyPattern.test(value)
}

export function extractLocalFileStorageKey(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith('/files/')) {
    return null
  }

  const suffixIndex = url.search(/[?#]/)
  const pathname = suffixIndex === -1
    ? url
    : url.slice(0, suffixIndex)
  const storageKey = pathname.slice('/files/'.length)

  if (!isSafeFileStorageKey(storageKey)) {
    return null
  }

  return storageKey
}

const preferredExtensionByMediaType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'text/plain': 'txt',
}

export function normalizeMediaType(
  mediaType: string,
): string {
  const [typeWithSubtype] = mediaType.split(';')
  const normalized = (typeWithSubtype || '')
    .trim()
    .toLowerCase()

  if (!normalized || !normalized.includes('/')) {
    return ''
  }

  return normalized
}

export function getPreferredFileExtension(
  mediaType: string,
): string {
  const normalizedMediaType = normalizeMediaType(mediaType)

  if (!normalizedMediaType) {
    return 'bin'
  }

  const preferredExtension = preferredExtensionByMediaType[normalizedMediaType]

  if (preferredExtension) {
    return preferredExtension
  }

  const subtype = normalizedMediaType.split('/')[1] || ''
  const plusSuffix = subtype.split('+').pop() || ''
  const normalizedSubtype = plusSuffix
    .trim()
    .toLowerCase()
    .replace(/^x-/, '')

  if (!normalizedSubtype || !/^[a-z0-9-]+$/.test(normalizedSubtype)) {
    return 'bin'
  }

  return normalizedSubtype
}
