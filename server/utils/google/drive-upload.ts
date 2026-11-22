import { GOOGLE_DOWNLOAD_TIMEOUT_MS, googleFetchJson } from '~~/server/utils/google/http'
import type { GoogleFetchImplementation } from '~~/server/utils/google/http'
import { readReason } from '~~/server/utils/google/drive'

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
  + '?uploadType=multipart&supportsAllDrives=true'
const FALLBACK_MEDIA_TYPE = 'application/octet-stream'
const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/

export interface CreateDriveFileInput {
  accessToken: string
  name: string
  mediaType: string
  bytes: Uint8Array
  fetchImpl?: GoogleFetchImplementation
}

export type CreateDriveFileResult
  = | { ok: true, driveFileId: string }
    | { ok: false, status: number, reason: string | null }

function safeMediaType(mediaType: string): string {
  const base = (mediaType.split(';')[0] ?? '').trim().toLowerCase()

  return MEDIA_TYPE_PATTERN.test(base) ? base : FALLBACK_MEDIA_TYPE
}

/**
 * The `multipart/related` body of a Drive `files.create` upload: the JSON
 * metadata (only the name, so the file lands in My Drive as a new file that
 * keeps the media type it is sent with) and the bytes, in this order.
 */
export function buildDriveMultipartBody(input: {
  boundary: string
  name: string
  mediaType: string
  bytes: Uint8Array
}): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${input.boundary}\r\n`
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + `${JSON.stringify({ name: input.name })}\r\n`
    + `--${input.boundary}\r\n`
    + `Content-Type: ${safeMediaType(input.mediaType)}\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${input.boundary}--`)
  const body = new Uint8Array(
    head.byteLength + input.bytes.byteLength + tail.byteLength,
  )

  body.set(head, 0)
  body.set(input.bytes, head.byteLength)
  body.set(tail, head.byteLength + input.bytes.byteLength)

  return body
}

/**
 * Creates one new file in the user's Google Drive with the multipart upload
 * of `files.create` (POST on the upload path of `www.googleapis.com`, which
 * the outbound allow-list already holds). Never updates an existing file:
 * `files.create` always makes a new one. The answer carries only the id.
 */
export async function createDriveFile(
  input: CreateDriveFileInput,
): Promise<CreateDriveFileResult> {
  const boundary = `besidka-${crypto.randomUUID().replaceAll('-', '')}`
  const response = await googleFetchJson(
    DRIVE_UPLOAD_URL,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${input.accessToken}` },
      rawBody: {
        contentType: `multipart/related; boundary=${boundary}`,
        data: buildDriveMultipartBody({
          boundary,
          name: input.name,
          mediaType: input.mediaType,
          bytes: input.bytes,
        }),
      },
    },
    {
      timeoutMs: GOOGLE_DOWNLOAD_TIMEOUT_MS,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    },
  )

  const driveFileId = response.body?.id

  if (response.ok && typeof driveFileId === 'string' && driveFileId) {
    return { ok: true, driveFileId }
  }

  return {
    ok: false,
    status: response.ok ? 502 : response.status,
    reason: readReason(response.body),
  }
}
