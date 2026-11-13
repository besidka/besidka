import { Inflate } from 'fflate'
import { readZipDirectory } from '@besidka/doc-renderer/zip'
import type { ZipEntry, ZipLimits } from '@besidka/doc-renderer/zip'
import {
  SKILL_MAX_ARCHIVE_ENTRIES,
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_RATIO,
  SKILL_MAX_SKILL_MD_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_MAX_UPLOAD_BYTES,
  SKILL_RATIO_MIN_BYTES,
} from '#shared/utils/skills-policy'
import {
  SKILL_MD_FILE_NAME,
  checkSkillRelativePath,
  detectSkillRoot,
  normaliseSkillEntryName,
} from '#shared/utils/skills/path'
import type { SkillPathRejection } from '#shared/utils/skills/path'

export const SKILL_ARCHIVE_LIMITS: ZipLimits = {
  entriesMax: SKILL_MAX_ARCHIVE_ENTRIES,
  entryBytesMax: SKILL_MAX_FILE_BYTES,
  totalBytesMax: SKILL_MAX_TOTAL_BYTES,
  ratioMax: SKILL_MAX_RATIO,
  ratioMinBytes: SKILL_RATIO_MIN_BYTES,
}

export type SkillArchiveErrorCode
  = | 'archive-too-large'
    | 'archive-invalid'
    | 'archive-zip64'
    | 'archive-encrypted'
    | 'archive-too-many-entries'
    | 'archive-entry-too-large'
    | 'archive-total-too-large'
    | 'archive-ratio'
    | 'archive-unsafe-path'
    | 'archive-symlink'
    | 'archive-special-file'
    | 'archive-path-rejected'
    | 'archive-too-many-files'
    | 'archive-missing-skill-md'
    | 'archive-ambiguous-root'
    | 'archive-skill-md-too-large'
    | 'archive-not-utf8'
    | 'archive-binary-content'
    | 'archive-corrupt'

export interface SkillArchiveFile {
  path: string
  bytes: Uint8Array
  text: string
}

export type SkillArchiveResult
  = | {
    ok: true
    files: SkillArchiveFile[]
    folderName: string | null
    totalBytes: number
    warnings: string[]
  }
  | {
    ok: false
    code: SkillArchiveErrorCode
    message: string
    path?: string
  }

interface EntryAttributes {
  hostSystem: number
  externalAttributes: number
}

const END_RECORD_SIGNATURE = 0x06054B50
const CENTRAL_RECORD_SIGNATURE = 0x02014B50
const END_RECORD_BYTES = 22
const CENTRAL_RECORD_BYTES = 46
const MAX_COMMENT_BYTES = 0xFFFF
const UNIX_HOST_SYSTEM = 3
const UNIX_FILE_TYPE_MASK = 0xF000
const UNIX_SYMLINK = 0xA000
const UNIX_REGULAR_FILE = 0x8000
const UNIX_DIRECTORY = 0x4000

const REJECTION_MESSAGES: Record<SkillPathRejection, string> = {
  'empty': 'An entry has an empty name',
  'absolute': 'An entry has an absolute path',
  'traversal': 'An entry tries to leave the skill folder',
  'backslash': 'An entry name contains a backslash',
  'control-character': 'An entry name contains a control character',
  'format-character': 'An entry name contains a hidden or bidirectional character',
  'too-long': 'An entry path is longer than 200 characters',
  'too-deep': 'An entry path is nested more than 6 levels deep',
  'extension-denied': 'Binary and compiled files are not allowed in a skill',
  'extension-not-allowed': 'Only text files are allowed in a skill',
}

const directoryErrorCodes: Record<string, SkillArchiveErrorCode> = {
  zip_invalid: 'archive-invalid',
  zip64: 'archive-zip64',
  zip_encrypted: 'archive-encrypted',
  zip_method: 'archive-invalid',
  zip_too_many_entries: 'archive-too-many-entries',
  zip_entry_too_large: 'archive-entry-too-large',
  zip_total_too_large: 'archive-total-too-large',
  zip_ratio: 'archive-ratio',
  zip_unsafe_path: 'archive-unsafe-path',
  zip_duplicate_entry: 'archive-invalid',
  zip_size_mismatch: 'archive-corrupt',
}

const INFLATE_SLICE_BYTES = 4096
const fatalDecoder = new TextDecoder('utf-8', { fatal: true })

type InflateOutcome
  = | { ok: true, data: Uint8Array }
    | { ok: false, code: SkillArchiveErrorCode, message: string }

class InflateCapExceeded extends Error {}

/**
 * Streaming inflate with a running byte cap equal to the declared size. A
 * patched archive can declare 1 KiB and carry a bomb, so the cap, not the
 * declaration, is the bound, and a length that differs from it is refused.
 */
function inflateSkillEntry(
  archive: Uint8Array,
  entry: ZipEntry,
): InflateOutcome {
  const raw = archive.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  )

  if (entry.method === 0) {
    return { ok: true, data: raw.slice() }
  }

  const output = new Uint8Array(entry.uncompressedSize)
  let written = 0

  try {
    const inflater = new Inflate((chunk) => {
      if (written + chunk.length > entry.uncompressedSize) {
        throw new InflateCapExceeded()
      }

      output.set(chunk, written)
      written += chunk.length
    })

    for (let start = 0; start < raw.length; start += INFLATE_SLICE_BYTES) {
      const end = Math.min(start + INFLATE_SLICE_BYTES, raw.length)

      inflater.push(raw.subarray(start, end), end === raw.length)
    }

    if (raw.length === 0) {
      inflater.push(new Uint8Array(0), true)
    }
  } catch (exception) {
    return exception instanceof InflateCapExceeded
      ? {
        ok: false,
        code: 'archive-corrupt',
        message: 'An entry inflates beyond its declared size',
      }
      : {
        ok: false,
        code: 'archive-corrupt',
        message: 'An entry is not valid deflate data',
      }
  }

  if (written !== entry.uncompressedSize) {
    return {
      ok: false,
      code: 'archive-corrupt',
      message: 'An entry inflates to a different size than declared',
    }
  }

  return { ok: true, data: output }
}

function failure(
  code: SkillArchiveErrorCode,
  message: string,
  path?: string,
): SkillArchiveResult {
  return path === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, path }
}

/**
 * The symlink bit and the unix file type live only in the central
 * directory, and neither the directory reader of doc-renderer nor a
 * streaming unzip exposes them. Call this only after `readZipDirectory`
 * accepted the archive, so every record is known to be well formed.
 */
export function readZipEntryAttributes(
  bytes: Uint8Array,
): EntryAttributes[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lastOffset = view.byteLength - END_RECORD_BYTES
  const firstOffset = Math.max(0, lastOffset - MAX_COMMENT_BYTES)
  let endOffset = -1

  for (let offset = lastOffset; offset >= firstOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_RECORD_SIGNATURE) {
      endOffset = offset

      break
    }
  }

  if (endOffset < 0) {
    return null
  }

  const count = view.getUint16(endOffset + 10, true)
  let offset = view.getUint32(endOffset + 16, true)
  const attributes: EntryAttributes[] = []

  for (let index = 0; index < count; index += 1) {
    if (
      offset + CENTRAL_RECORD_BYTES > endOffset
      || view.getUint32(offset, true) !== CENTRAL_RECORD_SIGNATURE
    ) {
      return null
    }

    attributes.push({
      hostSystem: view.getUint16(offset + 4, true) >>> 8,
      externalAttributes: view.getUint32(offset + 38, true),
    })

    offset += CENTRAL_RECORD_BYTES
      + view.getUint16(offset + 28, true)
      + view.getUint16(offset + 30, true)
      + view.getUint16(offset + 32, true)
  }

  return attributes
}

function readUnixFileType(attributes: EntryAttributes): number | null {
  if (attributes.hostSystem !== UNIX_HOST_SYSTEM) {
    return null
  }

  return (attributes.externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK
}

/**
 * One implementation of the archive rules of docs/skills.md section 3.2 for
 * the browser worker and the server. Nothing is inflated until every entry
 * name, type, count and declared size has passed, and every inflate runs
 * under a streaming byte cap, so a forged size cannot hide a bomb.
 */
export function extractSkillArchive(bytes: Uint8Array): SkillArchiveResult {
  if (bytes.byteLength > SKILL_MAX_UPLOAD_BYTES) {
    return failure(
      'archive-too-large',
      `The archive is larger than ${SKILL_MAX_UPLOAD_BYTES / 1024 / 1024} MiB`,
    )
  }

  const directory = readZipDirectory(bytes, SKILL_ARCHIVE_LIMITS)

  if (!directory.ok) {
    return failure(
      directoryErrorCodes[directory.code] ?? 'archive-invalid',
      directory.detail,
    )
  }

  const attributes = readZipEntryAttributes(bytes)

  if (!attributes || attributes.length !== directory.directory.entries.length) {
    return failure('archive-invalid', 'The central directory is malformed')
  }

  const warnings: string[] = []
  const kept: Array<{
    entry: ZipEntry
    path: string
  }> = []
  let skippedNoise = 0

  for (const [index, entry] of directory.directory.entries.entries()) {
    const fileType = readUnixFileType(attributes[index]!)

    if (fileType === UNIX_SYMLINK) {
      return failure('archive-symlink', 'Symbolic links are not allowed', entry.name)
    }

    if (
      fileType !== null
      && fileType !== 0
      && fileType !== UNIX_REGULAR_FILE
      && fileType !== UNIX_DIRECTORY
    ) {
      return failure(
        'archive-special-file',
        'Only regular files are allowed',
        entry.name,
      )
    }

    const normalised = normaliseSkillEntryName(entry.name)

    if (normalised.status === 'reject') {
      return failure(
        'archive-path-rejected',
        REJECTION_MESSAGES[normalised.reason],
        entry.name,
      )
    }

    if (normalised.status === 'skip') {
      if (normalised.reason !== 'directory') {
        skippedNoise += 1
      }

      continue
    }

    kept.push({ entry, path: normalised.path })
  }

  const paths = kept.map((item) => {
    return item.path
  })
  const uniquePaths = new Set(paths)

  if (uniquePaths.size !== paths.length) {
    return failure('archive-invalid', 'Two entries resolve to the same path')
  }

  const root = detectSkillRoot(paths)

  if (!root.ok) {
    return root.code === 'missing-skill-md'
      ? failure(
        'archive-missing-skill-md',
        'No SKILL.md found at the archive root or in a single top-level folder',
      )
      : failure(
        'archive-ambiguous-root',
        'More than one top-level folder holds a SKILL.md',
      )
  }

  const selected: Array<{
    entry: ZipEntry
    path: string
  }> = []
  let skippedOutsideRoot = 0

  for (const item of kept) {
    if (!item.path.startsWith(root.root)) {
      skippedOutsideRoot += 1

      continue
    }

    const relativePath = item.path.slice(root.root.length)
    const rejection = checkSkillRelativePath(relativePath)

    if (rejection) {
      return failure(
        'archive-path-rejected',
        REJECTION_MESSAGES[rejection],
        relativePath,
      )
    }

    selected.push({ entry: item.entry, path: relativePath })
  }

  if (selected.length > SKILL_MAX_FILES) {
    return failure(
      'archive-too-many-files',
      `The skill has more than ${SKILL_MAX_FILES} files`,
    )
  }

  const files: SkillArchiveFile[] = []
  let totalBytes = 0

  for (const { entry, path } of selected) {
    const inflated = inflateSkillEntry(bytes, entry)

    if (!inflated.ok) {
      return failure(inflated.code, inflated.message, path)
    }

    const data = inflated.data

    if (data.byteLength > SKILL_MAX_FILE_BYTES) {
      return failure('archive-entry-too-large', 'A file is over 1 MiB', path)
    }

    if (
      path === SKILL_MD_FILE_NAME
      && data.byteLength > SKILL_MAX_SKILL_MD_BYTES
    ) {
      return failure(
        'archive-skill-md-too-large',
        'SKILL.md is over 256 KiB',
        path,
      )
    }

    totalBytes += data.byteLength

    if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
      return failure(
        'archive-total-too-large',
        'The skill is over 5 MiB uncompressed',
      )
    }

    let text: string

    try {
      text = fatalDecoder.decode(data)
    } catch {
      return failure('archive-not-utf8', 'A file is not valid UTF-8 text', path)
    }

    if (text.includes('\u0000')) {
      return failure(
        'archive-binary-content',
        'A file contains binary data',
        path,
      )
    }

    files.push({ path, bytes: data, text })
  }

  if (
    totalBytes > SKILL_RATIO_MIN_BYTES
    && totalBytes / Math.max(bytes.byteLength, 1) > SKILL_MAX_RATIO
  ) {
    return failure(
      'archive-ratio',
      `The archive expands more than ${SKILL_MAX_RATIO}:1`,
    )
  }

  if (skippedNoise > 0) {
    warnings.push(`Skipped ${skippedNoise} macOS metadata files`)
  }

  if (skippedOutsideRoot > 0) {
    warnings.push(
      `Ignored ${skippedOutsideRoot} files outside the skill folder`,
    )
  }

  files.sort((left, right) => {
    if (left.path === SKILL_MD_FILE_NAME || right.path === SKILL_MD_FILE_NAME) {
      return left.path === SKILL_MD_FILE_NAME ? -1 : 1
    }

    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  })

  return {
    ok: true,
    files,
    folderName: root.folderName,
    totalBytes,
    warnings,
  }
}
