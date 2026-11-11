export type ContainerFileKind = 'image' | 'text' | 'pdf' | 'office'

export type ContainerOfficeFormat = 'docx' | 'xlsx' | 'pptx'

export interface AllowedContainerFileType {
  extension: string
  mediaType: string
  kind: ContainerFileKind
}

export type ContainerFileTypeResult
  = | { ok: true, type: AllowedContainerFileType }
    | { ok: false }

const MAX_FILE_NAME_LENGTH = 120
const FALLBACK_FILE_NAME = 'file'
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]
const TEXT_PROBE_BYTES = 64 * 1024

const ALLOWED_TYPES: Record<string, AllowedContainerFileType> = {
  png: { extension: 'png', mediaType: 'image/png', kind: 'image' },
  jpg: { extension: 'jpg', mediaType: 'image/jpeg', kind: 'image' },
  jpeg: { extension: 'jpg', mediaType: 'image/jpeg', kind: 'image' },
  webp: { extension: 'webp', mediaType: 'image/webp', kind: 'image' },
  csv: { extension: 'csv', mediaType: 'text/csv', kind: 'text' },
  tsv: {
    extension: 'tsv',
    mediaType: 'text/tab-separated-values',
    kind: 'text',
  },
  txt: { extension: 'txt', mediaType: 'text/plain', kind: 'text' },
  md: { extension: 'md', mediaType: 'text/markdown', kind: 'text' },
  json: { extension: 'json', mediaType: 'application/json', kind: 'text' },
  pdf: { extension: 'pdf', mediaType: 'application/pdf', kind: 'pdf' },
  docx: {
    extension: 'docx',
    mediaType: 'application/vnd.openxmlformats-officedocument'
      + '.wordprocessingml.document',
    kind: 'office',
  },
  xlsx: {
    extension: 'xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument'
      + '.spreadsheetml.sheet',
    kind: 'office',
  },
  pptx: {
    extension: 'pptx',
    mediaType: 'application/vnd.openxmlformats-officedocument'
      + '.presentationml.presentation',
    kind: 'office',
  },
}

const strictTextDecoder = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
})

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function hasMatchingSignature(
  bytes: Uint8Array,
  type: AllowedContainerFileType,
): boolean {
  if (type.extension === 'png') {
    return startsWith(bytes, PNG_SIGNATURE)
  }

  if (type.extension === 'jpg') {
    return startsWith(bytes, JPEG_SIGNATURE)
  }

  if (type.extension === 'webp') {
    return startsWith(bytes, RIFF_SIGNATURE)
      && startsWith(bytes, WEBP_SIGNATURE, 8)
  }

  if (type.kind === 'pdf') {
    return startsWith(bytes, PDF_SIGNATURE)
  }

  if (type.kind === 'office') {
    return startsWith(bytes, ZIP_SIGNATURE)
  }

  return isPlainText(bytes)
}

function isPlainText(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, TEXT_PROBE_BYTES)

  if (probe.includes(0)) {
    return false
  }

  try {
    strictTextDecoder.decode(probe, {
      stream: probe.byteLength < bytes.byteLength,
    })

    return true
  } catch {
    return false
  }
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')

  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

/**
 * Accepts a container output file only when its extension is on the allowlist
 * and its leading bytes match that type. SVG, HTML, GIF (no AI marking
 * exists for it), archives, executables and everything else are rejected.
 */
export function resolveContainerFileType(
  fileName: string,
  bytes: Uint8Array,
): ContainerFileTypeResult {
  const type = ALLOWED_TYPES[getFileExtension(fileName)]

  if (!type || bytes.byteLength === 0) {
    return { ok: false }
  }

  return hasMatchingSignature(bytes, type)
    ? { ok: true, type }
    : { ok: false }
}

export function isAllowedContainerFileName(fileName: string): boolean {
  return getFileExtension(fileName) in ALLOWED_TYPES
}

/**
 * Container file names are provider text: keep the last path segment, drop
 * control characters and path separators, cap the length.
 */
export function sanitizeContainerFileName(rawName: string): string {
  const lastSegment = rawName.split(/[\\/]/).pop() ?? ''
  const cleaned = Array.from(lastSegment)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0

      return codePoint >= 0x20 && codePoint !== 0x7f
    })
    .join('')
    .trim()

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return FALLBACK_FILE_NAME
  }

  if (cleaned.length <= MAX_FILE_NAME_LENGTH) {
    return cleaned
  }

  const extension = getFileExtension(cleaned)
  const suffix = extension ? `.${extension}` : ''

  return `${cleaned.slice(0, MAX_FILE_NAME_LENGTH - suffix.length)}${suffix}`
}
