import { GOOGLE_DRIVE_FILE_ID_PATTERN } from '#shared/utils/google-drive'
import type { GoogleDriveSearchKind } from '#shared/utils/google-gmail-tools'
import { classifyGmailFailure } from '~~/server/utils/google/gmail-api'
import type {
  GmailFailureCode,
  GmailRequestContext,
} from '~~/server/utils/google/gmail-api'
import { readReason } from '~~/server/utils/google/drive'
import { googleFetchJson } from '~~/server/utils/google/http'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const SEARCH_FIELDS = 'files(id,name,mimeType,modifiedTime)'
const FOLDER_MEDIA_TYPE = 'application/vnd.google-apps.folder'

const KIND_MEDIA_TYPES: Readonly<
  Record<Exclude<GoogleDriveSearchKind, 'any'>, string>
> = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
}

export interface DriveSearchHit {
  id: string
  name: string
  mimeType: string
  modifiedTime: Date | null
}

export type DriveSearchResult
  = | { ok: true, files: DriveSearchHit[] }
    | { ok: false, code: GmailFailureCode }

/**
 * A string for a Drive query literal: the backslash and the single quote
 * are escaped as the "Search for files and folders" guide says, and the
 * text can never end the literal early or add a clause.
 */
export function escapeDriveQueryText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')
}

/**
 * The `q` of a Drive search: a full-text match (Drive's `fullText` covers
 * the name, the description and the content) on the user's words, trashed
 * files and folders left out, and optionally one kind and a modified
 * date. Everything the model supplied is escaped or matched against a
 * fixed list.
 */
export function buildDriveSearchQuery(input: {
  query: string
  kind?: GoogleDriveSearchKind
  modifiedAfter?: string
}): string {
  const clauses = [
    `fullText contains '${escapeDriveQueryText(input.query)}'`,
    'trashed = false',
    `mimeType != '${FOLDER_MEDIA_TYPE}'`,
  ]

  if (input.kind && input.kind !== 'any') {
    clauses.push(`mimeType = '${KIND_MEDIA_TYPES[input.kind]}'`)
  }

  if (input.modifiedAfter) {
    clauses.push(`modifiedTime > '${input.modifiedAfter}T00:00:00'`)
  }

  return clauses.join(' and ')
}

/**
 * `files.list` over My Drive and shared drives with the bring-your-own
 * `drive.readonly` token. Only the id, name, type and modified time are
 * requested: no owner, no sharing data, no link from Google (the link is
 * built from the id).
 */
export async function searchDriveFiles(
  input: {
    query: string
    kind?: GoogleDriveSearchKind
    modifiedAfter?: string
    limit: number
  },
  context: GmailRequestContext,
): Promise<DriveSearchResult> {
  const url = `${DRIVE_FILES_URL}?${new URLSearchParams({
    q: buildDriveSearchQuery(input),
    pageSize: String(input.limit),
    corpora: 'allDrives',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    fields: SEARCH_FIELDS,
  }).toString()}`

  try {
    const response = await googleFetchJson(
      url,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${context.accessToken}` },
      },
      context.fetchImpl ? { fetchImpl: context.fetchImpl } : {},
    )

    if (!response.ok || !response.body) {
      return {
        ok: false,
        code: response.ok
          ? 'failed'
          : classifyGmailFailure(response.status, readReason(response.body)),
      }
    }

    const files = Array.isArray(response.body.files) ? response.body.files : []

    return {
      ok: true,
      files: files.flatMap((file: unknown): DriveSearchHit[] => {
        const record = file as Record<string, unknown> | null
        const modified = typeof record?.modifiedTime === 'string'
          ? Date.parse(record.modifiedTime)
          : Number.NaN

        if (
          typeof record?.id !== 'string'
          || !GOOGLE_DRIVE_FILE_ID_PATTERN.test(record.id)
        ) {
          return []
        }

        return [{
          id: record.id,
          name: typeof record.name === 'string' ? record.name : '',
          mimeType: typeof record.mimeType === 'string' ? record.mimeType : '',
          modifiedTime: Number.isNaN(modified) ? null : new Date(modified),
        }]
      }),
    }
  } catch {
    return { ok: false, code: 'failed' }
  }
}
