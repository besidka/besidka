export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`

  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`
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
