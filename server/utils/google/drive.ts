import {
  GOOGLE_DRIVE_FILE_ID_PATTERN,
  GOOGLE_DRIVE_RESOURCE_KEY_PATTERN,
} from '#shared/utils/google-drive'
import type { DriveImportFailureCode } from '#shared/utils/google-drive'
import { googleFetchBytes } from '~~/server/utils/google/download'
import type { GoogleDownloadResult } from '~~/server/utils/google/download'
import { googleFetchJson } from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const RESOURCE_KEYS_HEADER = 'X-Goog-Drive-Resource-Keys'
const METADATA_FIELDS = 'id,name,mimeType,size,modifiedTime,version,trashed,'
  + 'capabilities/canDownload'

export interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  size: number | null
  modifiedTime: Date | null
  version: string | null
  trashed: boolean
  canDownload: boolean
}

export interface DriveRequestContext {
  accessToken: string
  resourceKey?: string
  fetchImpl?: GoogleFetchImplementation
}

export type DriveMetadataResult
  = | { ok: true, metadata: DriveFileMetadata }
    | { ok: false, status: number, reason: string | null }

function assertSafeIds(fileId: string, resourceKey?: string) {
  const isSafe = GOOGLE_DRIVE_FILE_ID_PATTERN.test(fileId)
    && (
      resourceKey === undefined
      || GOOGLE_DRIVE_RESOURCE_KEY_PATTERN.test(resourceKey)
    )

  if (!isSafe) {
    throw new TypeError('Invalid Google Drive file id or resource key')
  }
}

function buildHeaders(
  fileId: string,
  context: DriveRequestContext,
): Record<string, string> {
  return {
    authorization: `Bearer ${context.accessToken}`,
    ...(context.resourceKey
      ? { [RESOURCE_KEYS_HEADER]: `${fileId}/${context.resourceKey}` }
      : {}),
  }
}

function toFetchOptions(context: DriveRequestContext): GoogleFetchOptions {
  return context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}
}

export function readReason(
  body: Record<string, unknown> | null,
): string | null {
  const error = body?.error

  if (typeof error !== 'object' || error === null) {
    return null
  }

  const errors = (error as { errors?: unknown }).errors

  if (Array.isArray(errors)) {
    const reason = (errors[0] as { reason?: unknown } | undefined)?.reason

    if (typeof reason === 'string') {
      return reason
    }
  }

  return null
}

function parseModifiedTime(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null
  }

  const time = Date.parse(value)

  return Number.isNaN(time) ? null : new Date(time)
}

/**
 * `files.get` metadata with `supportsAllDrives=true`, so a file on a shared
 * drive resolves, and the resource-key header when the Picker returned one.
 * Only the fields the import reads are requested.
 */
export async function fetchDriveFileMetadata(
  fileId: string,
  context: DriveRequestContext,
): Promise<DriveMetadataResult> {
  assertSafeIds(fileId, context.resourceKey)

  const url = `${DRIVE_FILES_URL}/${fileId}?supportsAllDrives=true`
    + `&fields=${encodeURIComponent(METADATA_FIELDS)}`
  const response = await googleFetchJson(
    url,
    { method: 'GET', headers: buildHeaders(fileId, context) },
    toFetchOptions(context),
  )

  if (!response.ok || !response.body) {
    return {
      ok: false,
      status: response.status,
      reason: readReason(response.body),
    }
  }

  const body = response.body
  const capabilities = body.capabilities as
    | { canDownload?: unknown }
    | undefined
  const size = typeof body.size === 'string' ? Number(body.size) : null

  if (typeof body.id !== 'string' || typeof body.mimeType !== 'string') {
    return { ok: false, status: 502, reason: 'malformed' }
  }

  return {
    ok: true,
    metadata: {
      id: body.id,
      name: typeof body.name === 'string' ? body.name : 'Google Drive file',
      mimeType: body.mimeType,
      size: size !== null && Number.isFinite(size) ? size : null,
      modifiedTime: parseModifiedTime(body.modifiedTime),
      version: typeof body.version === 'string' ? body.version : null,
      trashed: body.trashed === true,
      canDownload: capabilities?.canDownload !== false,
    },
  }
}

/**
 * `files.export` of a Google-native file. Google caps exports at 10 MB;
 * `maxBytes` is enforced while the body streams in.
 */
export async function exportDriveFile(
  fileId: string,
  exportMimeType: string,
  context: DriveRequestContext & { maxBytes: number },
): Promise<GoogleDownloadResult> {
  assertSafeIds(fileId, context.resourceKey)

  return await googleFetchBytes(
    `${DRIVE_FILES_URL}/${fileId}/export`
    + `?mimeType=${encodeURIComponent(exportMimeType)}`,
    { headers: buildHeaders(fileId, context) },
    { maxBytes: context.maxBytes, fetchImpl: context.fetchImpl },
  )
}

/**
 * `files.get?alt=media` of a binary file. Drive may answer with one
 * redirect to a `googleusercontent.com` host; `googleFetchBytes` follows it
 * and drops the bearer token on that hop.
 */
export async function downloadDriveFile(
  fileId: string,
  context: DriveRequestContext & { maxBytes: number },
): Promise<GoogleDownloadResult> {
  assertSafeIds(fileId, context.resourceKey)

  return await googleFetchBytes(
    `${DRIVE_FILES_URL}/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: buildHeaders(fileId, context) },
    { maxBytes: context.maxBytes, fetchImpl: context.fetchImpl },
  )
}

const NOT_DOWNLOADABLE_REASONS: ReadonlySet<string> = new Set([
  'downloadRestricted',
  'cannotDownloadFile',
  'fileNotDownloadable',
])

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
  'quotaExceeded',
])

/**
 * Maps a Drive answer that is not a success to one of the codes the user
 * sees. A 401 on a token that was just minted means Google revoked the
 * grant, so the user must reconnect.
 */
export function classifyDriveFailure(
  status: number,
  reason: string | null,
): DriveImportFailureCode {
  if (status === 401) {
    return 'reauthorize'
  }

  if (status === 404) {
    return 'not_found'
  }

  if (reason === 'exportSizeLimitExceeded') {
    return 'export_too_large'
  }

  if (reason && NOT_DOWNLOADABLE_REASONS.has(reason)) {
    return 'not_downloadable'
  }

  if (status === 429 || (reason && RATE_LIMIT_REASONS.has(reason))) {
    return 'rate_limited'
  }

  if (status === 403) {
    return 'no_access'
  }

  return 'failed'
}

export function isUnsupportedExportFailure(status: number): boolean {
  return status === 400
}
