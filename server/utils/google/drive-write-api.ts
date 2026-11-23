import {
  GOOGLE_DRIVE_FILE_ID_PATTERN,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
} from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_LIST_FOLDER_MAX,
  isDriveRootAlias,
  isDriveWriteId,
} from '#shared/utils/google-drive-write'
import { readReason } from '~~/server/utils/google/drive'
import { escapeDriveQueryText } from '~~/server/utils/google/drive-search'
import {
  GOOGLE_RESPONSE_TOO_LARGE_MESSAGE,
  googleFetchJson,
} from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const GENERATE_IDS_URL = `${DRIVE_FILES_URL}/generateIds`
const CREATED_FIELDS = 'id,name,mimeType,parents'
const ITEM_META_FIELDS = 'id,name,mimeType,parents,ownedByMe,shared,driveId,'
  + 'trashed,appProperties,capabilities(canAddChildren)'
const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,parents,ownedByMe,'
  + 'shared,driveId)'
const APPROVAL_PROPERTY = 'besidkaApproval'
const DIGEST_PREFIX = 'drive-create'
const SERVICE_DISABLED_REASON = 'SERVICE_DISABLED'
const LIST_RESPONSE_MAX_BYTES = 256 * 1024
const BASE64_PADDING_PATTERN = /=+$/

export interface DriveWriteContext {
  accessToken: string
  fetchImpl?: GoogleFetchImplementation
}

export type DriveWriteFailureCode
  = | 'reauthorize'
    | 'api_disabled'
    | 'no_access'
    | 'drive_full'
    | 'not_found'
    | 'rate_limited'
    | 'too_large'
    | 'bad_request'
    | 'conflict'
    | 'failed'

export const DRIVE_WRITE_FAILURE_TEXT: Readonly<
  Record<DriveWriteFailureCode, string>
> = {
  reauthorize: 'Google no longer accepts the connection to your own Google '
    + 'client. Reconnect it in your Besidka settings.',
  api_disabled: 'The Google Drive API is not turned on in your Google Cloud '
    + 'project. Turn it on there and try again.',
  no_access: 'Google Drive did not allow this. You may have no permission to '
    + 'change this item, or Besidka needs the Change files access in your '
    + 'Besidka settings. Nothing changed.',
  drive_full: 'Your Google Drive storage is full, so nothing was created.',
  not_found: 'Google Drive could not find that item, or you have no access '
    + 'to it. Nothing changed.',
  rate_limited: 'Google Drive asked Besidka to slow down. Try again in a '
    + 'moment.',
  too_large: 'Google Drive answered with more than fits here. Nothing '
    + 'changed.',
  bad_request: 'Google Drive refused the request. Nothing changed.',
  conflict: 'Google Drive reported that an item with the same identifier '
    + 'already exists.',
  failed: 'Google Drive could not be reached or answered with an error. Try '
    + 'again in a moment.',
}

export const DRIVE_CREATE_UNCONFIRMED_TEXT = 'Google Drive did not confirm '
  + 'the folder, so it may or may not have been created. Ask the user to '
  + 'check their Google Drive before trying again.'

export const DRIVE_CREATE_NO_APPROVAL_TEXT = 'Nothing was created in Google '
  + 'Drive.'

export type DriveWriteResult<Value>
  = | { ok: true, value: Value }
    | { ok: false, code: DriveWriteFailureCode }

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
])

const NO_ACCESS_REASONS: ReadonlySet<string> = new Set([
  'insufficientFilePermissions',
  'insufficientPermissions',
  'forbidden',
  'appNotAuthorizedToFile',
  'cannotAddParent',
  'teamDriveFileLimitExceeded',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDriveReason(body: Record<string, unknown> | null): string | null {
  const error = body?.error
  const details = isRecord(error) ? error.details : undefined

  if (Array.isArray(details) && details.some((detail) => {
    return isRecord(detail) && detail.reason === SERVICE_DISABLED_REASON
  })) {
    return SERVICE_DISABLED_REASON
  }

  return readReason(body)
}

/**
 * Maps a Drive answer that is not a success to one code with a fixed
 * sentence (`DRIVE_WRITE_FAILURE_TEXT`). Google's own message text is never
 * forwarded: it can echo the request.
 */
export function classifyDriveWriteFailure(
  status: number,
  reason: string | null,
): DriveWriteFailureCode {
  if (status === 401) {
    return 'reauthorize'
  }

  if (reason === 'accessNotConfigured' || reason === SERVICE_DISABLED_REASON) {
    return 'api_disabled'
  }

  if (reason === 'storageQuotaExceeded') {
    return 'drive_full'
  }

  if (status === 404) {
    return 'not_found'
  }

  if (status === 409) {
    return 'conflict'
  }

  if (status === 429 || (reason && RATE_LIMIT_REASONS.has(reason))) {
    return 'rate_limited'
  }

  if (status === 403 || (reason && NO_ACCESS_REASONS.has(reason))) {
    return 'no_access'
  }

  return status === 400 ? 'bad_request' : 'failed'
}

function classifyException(exception: unknown): DriveWriteFailureCode {
  const message = exception instanceof Error ? exception.message : ''

  return message === GOOGLE_RESPONSE_TOO_LARGE_MESSAGE ? 'too_large' : 'failed'
}

function toFetchOptions(
  context: DriveWriteContext,
  extra: GoogleFetchOptions,
): GoogleFetchOptions {
  return context.fetchImpl
    ? { ...extra, fetchImpl: context.fetchImpl }
    : extra
}

function headersOf(context: DriveWriteContext): Record<string, string> {
  return { authorization: `Bearer ${context.accessToken}` }
}

async function requestJson(
  url: string,
  request: Parameters<typeof googleFetchJson>[1],
  options: GoogleFetchOptions,
): Promise<DriveWriteResult<Record<string, unknown>>> {
  try {
    const response = await googleFetchJson(url, request, options)

    if (!response.ok || !response.body) {
      return {
        ok: false,
        code: response.ok
          ? 'failed'
          : classifyDriveWriteFailure(
            response.status,
            readDriveReason(response.body),
          ),
      }
    }

    return { ok: true, value: response.body }
  } catch (exception) {
    return { ok: false, code: classifyException(exception) }
  }
}

function isBoundaryItemId(value: string): boolean {
  return isDriveRootAlias(value) || isDriveWriteId(value)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(BASE64_PADDING_PATTERN, '')
}

/**
 * The retry marker of one approved create: a base64url SHA-256 of the user
 * and the approval id, never the approval id itself. It is the KV key suffix
 * and the `besidkaApproval` app property the created item carries.
 */
export async function buildDriveCreateDigest(
  userId: number,
  approvalId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${DIGEST_PREFIX}:${userId}:${approvalId}`),
  )

  return toBase64Url(new Uint8Array(digest))
}

export interface DriveCreateMetadataInput {
  name: string
  mimeType: string
  parentId: string | null
  id: string
  approvalDigest: string
}

/**
 * The metadata body of one create, copied field by field: a name, a media
 * type, at most one parent, the id that `generateDriveId` returned and one
 * app property. Nothing else can be in it, whatever object the caller
 * passes: no permissions, no description, no sharing flags, no shortcut
 * details. A missing parent sends no `parents`, which means My Drive.
 */
export function buildDriveCreateMetadata(
  input: DriveCreateMetadataInput,
): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType,
    ...(input.parentId ? { parents: [input.parentId] } : {}),
    appProperties: { [APPROVAL_PROPERTY]: input.approvalDigest },
  }
}

/**
 * One Drive file id from `files.generateIds`, which Drive can later accept
 * in a create. The shape is checked, so a Drive id is never anything else.
 */
export async function generateDriveId(
  context: DriveWriteContext,
): Promise<DriveWriteResult<string>> {
  const result = await requestJson(
    `${GENERATE_IDS_URL}?${new URLSearchParams({
      count: '1',
      space: 'drive',
      type: 'files',
    }).toString()}`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const ids = result.value.ids
  const id = Array.isArray(ids) && ids.length === 1 ? ids[0] : null

  return typeof id === 'string' && GOOGLE_DRIVE_FILE_ID_PATTERN.test(id)
    ? { ok: true, value: id }
    : { ok: false, code: 'failed' }
}

export interface DriveItemMeta {
  id: string
  name: string
  mimeType: string
  parents: string[]
  ownedByMe: boolean | null
  shared: boolean | null
  driveId: string | null
  trashed: boolean | null
  canAddChildren: boolean | null
  approvalDigest: string | null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Whether a live `files.get` answer is the top level of the user's own My
 * Drive: a folder that nothing contains, that the user owns, outside any
 * shared drive. The decision is taken from Drive's answer, never from a name
 * or from what an earlier tool result called the folder.
 */
export function isDriveRootMeta(meta: DriveItemMeta): boolean {
  return meta.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE
    && meta.parents.length === 0
    && meta.ownedByMe === true
    && meta.driveId === null
}

function readItemMeta(value: Record<string, unknown>): DriveItemMeta | null {
  if (
    typeof value.id !== 'string'
    || !GOOGLE_DRIVE_FILE_ID_PATTERN.test(value.id)
  ) {
    return null
  }

  const parents = Array.isArray(value.parents)
    ? value.parents.filter((parent): parent is string => {
      return typeof parent === 'string'
        && GOOGLE_DRIVE_FILE_ID_PATTERN.test(parent)
    })
    : []

  if (Array.isArray(value.parents) && parents.length !== value.parents.length) {
    return null
  }

  const capabilities = isRecord(value.capabilities)
    ? value.capabilities
    : null
  const appProperties = isRecord(value.appProperties)
    ? value.appProperties
    : null
  const approval = appProperties?.[APPROVAL_PROPERTY]

  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : '',
    parents,
    ownedByMe: booleanOrNull(value.ownedByMe),
    shared: booleanOrNull(value.shared),
    driveId: typeof value.driveId === 'string' && value.driveId
      ? value.driveId
      : null,
    trashed: booleanOrNull(value.trashed),
    canAddChildren: booleanOrNull(capabilities?.canAddChildren),
    approvalDigest: typeof approval === 'string' ? approval : null,
  }
}

/**
 * `files.get` of one item with the fields the write checks need: type,
 * parents, ownership, sharing, shared-drive membership, trash state, whether
 * children can be added, and the retry marker. `supportsAllDrives` is always
 * on, so an item in a shared drive is recognized (and refused by the caller)
 * instead of answering 404.
 */
export async function readDriveItemMeta(
  itemId: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<DriveItemMeta>> {
  if (!isBoundaryItemId(itemId)) {
    return { ok: false, code: 'bad_request' }
  }

  const result = await requestJson(
    `${DRIVE_FILES_URL}/${encodeURIComponent(itemId)}?${new URLSearchParams({
      supportsAllDrives: 'true',
      fields: ITEM_META_FIELDS,
    }).toString()}`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const meta = readItemMeta(result.value)

  return meta ? { ok: true, value: meta } : { ok: false, code: 'failed' }
}

export interface CreatedDriveItem {
  id: string
  name: string
  mimeType: string
  parents: string[]
}

/**
 * `files.create` with JSON metadata only (a folder). The one write of this
 * module: a POST of the body `buildDriveCreateMetadata` builds, with
 * `supportsAllDrives=true`. The caller treats a `conflict` (409) as a
 * success only after it has read the item back and checked the retry marker.
 */
export async function createDriveItem(
  metadata: Record<string, unknown>,
  context: DriveWriteContext,
): Promise<DriveWriteResult<CreatedDriveItem>> {
  const result = await requestJson(
    `${DRIVE_FILES_URL}?${new URLSearchParams({
      supportsAllDrives: 'true',
      fields: CREATED_FIELDS,
    }).toString()}`,
    {
      method: 'POST',
      headers: headersOf(context),
      rawBody: {
        contentType: 'application/json',
        data: new TextEncoder().encode(
          JSON.stringify(metadata),
        ) as Uint8Array<ArrayBuffer>,
      },
    },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const meta = readItemMeta(result.value)

  return meta
    ? {
      ok: true,
      value: {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents,
      },
    }
    : { ok: false, code: 'failed' }
}

export interface ListedDriveItem {
  id: string
  name: string
  mimeType: string
  ownedByMe: boolean | null
  shared: boolean | null
  inSharedDrive: boolean
  parentId: string | null
}

export interface ListedDriveItems {
  items: ListedDriveItem[]
  hasMore: boolean
}

function readListedItem(value: unknown): ListedDriveItem[] {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !GOOGLE_DRIVE_FILE_ID_PATTERN.test(value.id)
  ) {
    return []
  }

  return [{
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : '',
    ownedByMe: booleanOrNull(value.ownedByMe),
    shared: booleanOrNull(value.shared),
    inSharedDrive: typeof value.driveId === 'string' && value.driveId !== '',
    parentId: Array.isArray(value.parents)
      && value.parents.length === 1
      && typeof value.parents[0] === 'string'
      && GOOGLE_DRIVE_FILE_ID_PATTERN.test(value.parents[0])
      ? value.parents[0]
      : null,
  }]
}

async function listDriveItems(
  query: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<ListedDriveItems>> {
  const result = await requestJson(
    `${DRIVE_FILES_URL}?${new URLSearchParams({
      q: query,
      pageSize: String(GOOGLE_DRIVE_LIST_FOLDER_MAX),
      corpora: 'user',
      supportsAllDrives: 'true',
      orderBy: 'folder,name',
      fields: LIST_FIELDS,
    }).toString()}`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, { maxResponseBytes: LIST_RESPONSE_MAX_BYTES }),
  )

  if (!result.ok) {
    return result
  }

  const files = Array.isArray(result.value.files) ? result.value.files : []

  return {
    ok: true,
    value: {
      items: files.flatMap(readListedItem),
      hasMore: typeof result.value.nextPageToken === 'string'
        && result.value.nextPageToken.length > 0,
    },
  }
}

/**
 * The children of one folder that is not in the trash, folders first, at
 * most 50. `folderId` is the alias `root` or an id the caller already
 * validated; it is escaped like any query text.
 */
export async function listDriveFolderChildren(
  folderId: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<ListedDriveItems>> {
  if (!isBoundaryItemId(folderId)) {
    return { ok: false, code: 'bad_request' }
  }

  return await listDriveItems(
    `'${escapeDriveQueryText(folderId)}' in parents and trashed = false`,
    context,
  )
}

/**
 * The folders of the user's own Drive whose name contains the given text,
 * not in the trash, at most 50.
 */
export async function searchDriveFolders(
  text: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<ListedDriveItems>> {
  return await listDriveItems(
    `mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}' and trashed = false `
    + `and name contains '${escapeDriveQueryText(text)}'`,
    context,
  )
}
