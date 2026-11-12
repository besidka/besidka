import { normalizeMediaType } from '#shared/utils/files'

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'

export type OfficeTextStatus = 'ready' | 'empty' | 'failed' | 'too_large'

export type OfficeExtensionKind = 'office' | 'legacy' | 'macro'

export const OFFICE_FORMATS: readonly OfficeFormat[] = [
  'docx',
  'xlsx',
  'pptx',
]

export const OFFICE_MEDIA_TYPES: Record<OfficeFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument'
    + '.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument'
    + '.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument'
    + '.presentationml.presentation',
}

export const OFFICE_FORMAT_LABELS: Record<OfficeFormat, string> = {
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
}

export const OFFICE_FORMAT_NOUNS: Record<OfficeFormat, string> = {
  docx: 'Word document',
  xlsx: 'Excel spreadsheet',
  pptx: 'PowerPoint presentation',
}

export const OFFICE_SAVE_AS_FIX
  = 'Save the file as .docx, .xlsx or .pptx and attach that'

export const OFFICE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024

export const OFFICE_TEXT_MAX_BYTES = 1024 * 1024

export const OFFICE_TEXT_VERSION = 1

export const OFFICE_TEXT_SUFFIX = '.text.md'

export const OFFICE_TEXT_INLINE_MAX_BYTES = 200 * 1024

export const OFFICE_TEXT_MESSAGE_MAX_BYTES = 512 * 1024

const LEGACY_EXTENSIONS: readonly string[] = [
  'doc',
  'dot',
  'xls',
  'xlt',
  'xlsb',
  'ppt',
  'pps',
  'pot',
]

const MACRO_EXTENSIONS: readonly string[] = [
  'docm',
  'dotm',
  'xlsm',
  'xltm',
  'pptm',
  'potm',
  'ppsm',
  'sldm',
]

const LEGACY_MEDIA_TYPES: readonly string[] = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]

const MACRO_MEDIA_TYPE_PATTERN = /macroenabled/

export function getFileNameExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')

  return dotIndex > 0 ? fileName.slice(dotIndex + 1).trim().toLowerCase() : ''
}

export function isOfficeFormat(value: string): value is OfficeFormat {
  return (OFFICE_FORMATS as readonly string[]).includes(value)
}

export function getOfficeFormatByMediaType(
  mediaType: string,
): OfficeFormat | null {
  const normalized = normalizeMediaType(mediaType)

  return OFFICE_FORMATS.find((format) => {
    return OFFICE_MEDIA_TYPES[format] === normalized
  }) ?? null
}

export function isOfficeMediaType(mediaType: string): boolean {
  return getOfficeFormatByMediaType(mediaType) !== null
}

export function isLegacyOfficeMediaType(mediaType: string): boolean {
  const normalized = normalizeMediaType(mediaType)

  return LEGACY_MEDIA_TYPES.includes(normalized)
    || MACRO_MEDIA_TYPE_PATTERN.test(normalized)
}

export function getOfficeExtensionKind(
  fileName: string,
): OfficeExtensionKind | null {
  const extension = getFileNameExtension(fileName)

  if (isOfficeFormat(extension)) {
    return 'office'
  }

  if (LEGACY_EXTENSIONS.includes(extension)) {
    return 'legacy'
  }

  if (MACRO_EXTENSIONS.includes(extension)) {
    return 'macro'
  }

  return null
}

export function getOfficeFormatByFileName(
  fileName: string,
): OfficeFormat | null {
  const extension = getFileNameExtension(fileName)

  return isOfficeFormat(extension) ? extension : null
}

export function getOfficeTextStorageKey(storageKey: string): string {
  return `${storageKey}${OFFICE_TEXT_SUFFIX}`
}

export function isOfficeStorageKey(storageKey: string): boolean {
  return OFFICE_FORMATS.some((format) => {
    return storageKey.endsWith(`.${format}`)
  })
}

/**
 * Returns the keys plus the keys of their extracted-text sidecars, so one
 * batched R2 delete removes a file and its derivative together. Only Office
 * keys have a sidecar, so other keys add nothing.
 */
export function withDerivedKeys(keys: readonly string[]): string[] {
  const derivedKeys = keys
    .filter(isOfficeStorageKey)
    .map(getOfficeTextStorageKey)

  return [...keys, ...derivedKeys]
}

/**
 * The upload allowlist for a user. `base` is `runtimeConfig.public
 * .allowedFileFormats`; the Office media types join it only while the
 * `files.office` flag is active, so the flag-off list is the base list.
 */
export function getAllowedFileFormats(
  base: readonly string[],
  options: { office: boolean },
): string[] {
  if (!options.office) {
    return [...base]
  }

  const officeMediaTypes = OFFICE_FORMATS.map((format) => {
    return OFFICE_MEDIA_TYPES[format]
  })

  return [...new Set([...base, ...officeMediaTypes])]
}
