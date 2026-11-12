import {
  getPreferredFileExtension,
  normalizeMediaType,
} from '#shared/utils/files'

export type FileShareOutcome
  = | 'shared'
    | 'cancelled'
    | 'needs-gesture'
    | 'unsupported'

const GENERIC_MEDIA_TYPE = 'application/octet-stream'
const ENCODED_FILE_NAME_PATTERN = /filename\*\s*=\s*UTF-8''([^;]+)/i
const QUOTED_FILE_NAME_PATTERN = /filename\s*=\s*"([^"]+)"/i
const BARE_FILE_NAME_PATTERN = /filename\s*=\s*([^;]+)/i

export function canUseShareSheet(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
}

function canShareFile(file: File): boolean {
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * Some iOS versions reject a file whose media type they do not list, while
 * still saving the same bytes under the generic type with the same name.
 */
export function toShareableFile(file: File): File | null {
  if (canShareFile(file)) {
    return file
  }

  const genericFile = new File([file], file.name, {
    type: GENERIC_MEDIA_TYPE,
  })

  return canShareFile(genericFile) ? genericFile : null
}

/**
 * Must be the first thing a click handler awaits when a fresh gesture is
 * needed: `navigator.share` is invoked synchronously, before any `await`.
 * WebKit consumes transient activation on `share()` and gives it a short
 * lifetime, so a slow `fetch` before it can end in `NotAllowedError`, see
 * https://webkit.org/blog/13862/the-user-activation-api/ and
 * https://bugs.webkit.org/show_bug.cgi?id=225559.
 */
export async function shareFile(file: File): Promise<FileShareOutcome> {
  const shareableFile = toShareableFile(file)

  if (!shareableFile) {
    return 'unsupported'
  }

  try {
    await navigator.share({ files: [shareableFile] })

    return 'shared'
  } catch (exception) {
    if (exception instanceof DOMException) {
      if (exception.name === 'AbortError') {
        return 'cancelled'
      }

      if (exception.name === 'NotAllowedError') {
        return 'needs-gesture'
      }
    }

    throw exception
  }
}

export function readContentDispositionFileName(
  contentDisposition: string | null,
): string {
  if (!contentDisposition) {
    return ''
  }

  const encodedMatch = contentDisposition.match(ENCODED_FILE_NAME_PATTERN)

  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim())
    } catch {
      return ''
    }
  }

  const quotedMatch = contentDisposition.match(QUOTED_FILE_NAME_PATTERN)

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim()
  }

  return contentDisposition.match(BARE_FILE_NAME_PATTERN)?.[1]?.trim() ?? ''
}

export function ensureFileExtension(
  fileName: string,
  mediaType: string,
): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  const hasExtension = lastDotIndex > 0
    && lastDotIndex < fileName.length - 1

  if (hasExtension) {
    return fileName
  }

  const baseName = fileName.replace(/\.+$/, '') || 'download'

  const extension = mediaType === GENERIC_MEDIA_TYPE
    ? 'bin'
    : getPreferredFileExtension(mediaType)

  return `${baseName}.${extension}`
}

export function createShareFile(
  blob: Blob,
  fileName: string,
  headerFileName: string = '',
): File {
  const mediaType = normalizeMediaType(blob.type) || GENERIC_MEDIA_TYPE
  const resolvedFileName = ensureFileExtension(
    headerFileName || fileName,
    mediaType,
  )

  return new File([blob], resolvedFileName, { type: mediaType })
}
