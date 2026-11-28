import { isGoogleCreatedFileKind } from '#shared/utils/google-created-file'
import type { GoogleCreatedFileKind } from '#shared/utils/google-created-file'

export const GOOGLE_FILE_DOWNLOAD_PATH
  = '/api/v1/google/drive/created-files/download'

export const GOOGLE_FILE_DOWNLOAD_FORMATS = [
  'docx',
  'txt',
  'xlsx',
  'csv',
] as const

export type GoogleFileDownloadFormat
  = typeof GOOGLE_FILE_DOWNLOAD_FORMATS[number]

export const GOOGLE_FILE_DOWNLOAD_NAME_MAX = 120
export const GOOGLE_FILE_DOWNLOAD_FALLBACK_NAME = 'Untitled'
export const GOOGLE_FILE_DOWNLOADS_PER_HOUR = 30

const DOCX_MIME_TYPE
  = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME_TYPE
  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface GoogleFileDownloadType {
  extension: string
  contentType: string
}

export const GOOGLE_FILE_DOWNLOAD_TYPES: Readonly<
  Record<GoogleFileDownloadFormat, GoogleFileDownloadType>
> = {
  docx: { extension: 'docx', contentType: DOCX_MIME_TYPE },
  txt: { extension: 'txt', contentType: 'text/plain; charset=utf-8' },
  xlsx: { extension: 'xlsx', contentType: XLSX_MIME_TYPE },
  csv: { extension: 'csv', contentType: 'text/csv; charset=utf-8' },
}

export interface GoogleFileDownloadOption {
  format: GoogleFileDownloadFormat
  label: string
  exportMimeType: string | null
}

/**
 * The one allowlist of what a created file can be downloaded as. A document
 * and a spreadsheet are exported by Drive (`files.export`); a plain text file
 * is the raw file (`exportMimeType: null`, `alt=media`). The CSV of a
 * spreadsheet is Google's export of the first sheet only, which its label
 * says. A format that is not listed for a kind is refused.
 */
export const GOOGLE_FILE_DOWNLOADS: Readonly<
  Record<GoogleCreatedFileKind, readonly GoogleFileDownloadOption[]>
> = {
  document: [
    {
      format: 'docx',
      label: 'Download as Word (.docx)',
      exportMimeType: DOCX_MIME_TYPE,
    },
    {
      format: 'txt',
      label: 'Download as text (.txt)',
      exportMimeType: 'text/plain',
    },
  ],
  spreadsheet: [
    {
      format: 'xlsx',
      label: 'Download as Excel (.xlsx)',
      exportMimeType: XLSX_MIME_TYPE,
    },
    {
      format: 'csv',
      label: 'Download first sheet as CSV',
      exportMimeType: 'text/csv',
    },
  ],
  text: [
    {
      format: 'txt',
      label: 'Download as text',
      exportMimeType: null,
    },
  ],
}

export function isGoogleFileDownloadFormat(
  value: unknown,
): value is GoogleFileDownloadFormat {
  return GOOGLE_FILE_DOWNLOAD_FORMATS.some(format => format === value)
}

export function getGoogleFileDownloadOptions(
  kind: unknown,
): readonly GoogleFileDownloadOption[] {
  return isGoogleCreatedFileKind(kind) ? GOOGLE_FILE_DOWNLOADS[kind] : []
}

export function findGoogleFileDownloadOption(
  kind: unknown,
  format: unknown,
): GoogleFileDownloadOption | null {
  return getGoogleFileDownloadOptions(kind).find((option) => {
    return option.format === format
  }) ?? null
}

export function buildGoogleFileDownloadUrl(input: {
  chatSlug: string
  fileId: string
  format: GoogleFileDownloadFormat
}): string {
  const query = new URLSearchParams({
    chatSlug: input.chatSlug,
    fileId: input.fileId,
    format: input.format,
  })

  return `${GOOGLE_FILE_DOWNLOAD_PATH}?${query.toString()}`
}

const UNSAFE_NAME_CHARACTERS = new Set(['/', '\\', '<', '>', ':', '"', '|', '?', '*'])
const KEPT_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.tsv',
])
const SAFE_EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,10}$/

function isUnsafeNameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  const isControl = code < 32
    || (code >= 127 && code <= 159)
    || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x2028 && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069)
    || (code >= 0xd800 && code <= 0xdfff)
    || code === 0xfeff

  return isControl || UNSAFE_NAME_CHARACTERS.has(character)
}

function cleanDownloadName(title: string): string {
  return Array.from(title, (character) => {
    return isUnsafeNameCharacter(character) ? ' ' : character
  }).join('')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
}

function splitName(
  cleaned: string,
  kind: GoogleCreatedFileKind,
  targetExtension: string,
): { base: string, extension: string } {
  const lowered = cleaned.toLowerCase()

  if (lowered.endsWith(targetExtension)) {
    return {
      base: cleaned.slice(0, cleaned.length - targetExtension.length),
      extension: targetExtension,
    }
  }

  const dotIndex = cleaned.lastIndexOf('.')
  const existing = dotIndex > 0 ? cleaned.slice(dotIndex) : ''

  if (kind === 'text' && KEPT_TEXT_EXTENSIONS.has(existing.toLowerCase())) {
    return { base: cleaned.slice(0, dotIndex), extension: existing }
  }

  return { base: cleaned, extension: targetExtension }
}

/**
 * The file name of a download, built from the stored title only: control,
 * invisible and direction characters, path separators and the characters
 * that are not allowed in a Windows name become spaces, leading dots and
 * trailing dots and spaces go, the base is cut by code point so the whole
 * name stays within `GOOGLE_FILE_DOWNLOAD_NAME_MAX`, and the extension of the
 * chosen format is added unless the title already ends with it. A plain text
 * file keeps an extension only from a short allowlist of text formats
 * (`notes.md` stays `notes.md`); any other one gets `.txt` appended, so a
 * title such as `fix.command` or `x.html` is never saved with that extension.
 */
export function buildGoogleFileDownloadName(
  title: string,
  kind: GoogleCreatedFileKind,
  format: GoogleFileDownloadFormat,
): string {
  const targetExtension = `.${GOOGLE_FILE_DOWNLOAD_TYPES[format].extension}`
  const { base, extension } = splitName(
    cleanDownloadName(title),
    kind,
    targetExtension,
  )
  const room = Math.max(1, GOOGLE_FILE_DOWNLOAD_NAME_MAX - extension.length)
  const cutBase = Array.from(base)
    .slice(0, room)
    .join('')
    .replace(/[.\s]+$/, '')

  return `${cutBase || GOOGLE_FILE_DOWNLOAD_FALLBACK_NAME}${extension}`
}

const PERCENT_ENCODED_CHARACTERS = /[!'()*]/g
const UNSAFE_FALLBACK_CHARACTERS = /[/\\<>:|?*%;"]/g

/**
 * The `Content-Disposition` of an attachment: a plain ASCII `filename` for
 * old clients and the exact name as `filename*` (RFC 5987). The ASCII name is
 * cleaned after Unicode normalization, because fullwidth separators fold
 * into `/`, `..`, `<`, `%` and `;` there.
 */
export function buildGoogleFileDisposition(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.')
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''
  const asciiName = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(UNSAFE_FALLBACK_CHARACTERS, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
  const safeExtension = SAFE_EXTENSION_PATTERN.test(extension) ? extension : ''
  const fallbackName = asciiName || `download${safeExtension}`
  const encodedName = encodeURIComponent(fileName)
    .replace(PERCENT_ENCODED_CHARACTERS, (character) => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    })

  return `attachment; filename="${fallbackName}"; `
    + `filename*=UTF-8''${encodedName}`
}
