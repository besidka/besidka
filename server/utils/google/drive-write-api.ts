import {
  GOOGLE_DRIVE_FILE_ID_PATTERN,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
} from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_FILE_KIND_SPECS,
  GOOGLE_DRIVE_LIST_FOLDER_MAX,
  isDriveConvertedKind,
  isDriveRootAlias,
  isDriveWriteId,
  validateCreateFileInput,
  validateDriveItemName,
} from '#shared/utils/google-drive-write'
import type { DriveFileKind } from '#shared/utils/google-drive-write'
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
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const GENERATE_IDS_URL = `${DRIVE_FILES_URL}/generateIds`
const APPROVAL_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/
const BOUNDARY_ATTEMPTS = 3
const CREATED_FIELDS = 'id,name,mimeType,parents'
export const ITEM_META_FIELDS = 'id,name,mimeType,parents,ownedByMe,shared,driveId,'
  + 'trashed,appProperties,'
  + 'capabilities(canAddChildren,canRename,canMoveItemWithinDrive)'
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

export const DRIVE_CREATE_FILE_UNCONFIRMED_TEXT = 'Google Drive did not '
  + 'confirm the file, so it may or may not have been created. Ask the user '
  + 'to check their Google Drive before trying again.'

export const DRIVE_CREATE_NO_APPROVAL_TEXT = 'Nothing was created in Google '
  + 'Drive.'

export const DRIVE_CHANGE_NO_APPROVAL_TEXT = 'Nothing was changed in Google '
  + 'Drive.'

export interface DriveWriteFailureDetail {
  code: DriveWriteFailureCode
  status?: number
  reason?: string | null
}

export type DriveWriteResult<Value>
  = | { ok: true, value: Value }
    | ({ ok: false } & DriveWriteFailureDetail)

const DRIVE_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/
const FIRST_HTTP_STATUS = 100
const LAST_HTTP_STATUS = 599

/**
 * A reason from a Drive answer, only when it is a short identifier such as
 * `forbidden`: it is shown to the model and written to the logs, so a value
 * with spaces, markup, other scripts or more than 41 characters becomes null.
 */
export function sanitizeDriveReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const reason = value.trim()

  return DRIVE_REASON_PATTERN.test(reason) ? reason : null
}

/**
 * The fixed-format tail of a failure sentence: the HTTP status Google
 * answered and, when it passed `sanitizeDriveReason`, its reason. Google's
 * message text is never part of it. Empty when the status is not known.
 */
export function driveFailureSuffix(
  status: number | null | undefined,
  reason?: unknown,
): string {
  if (
    typeof status !== 'number'
    || !Number.isInteger(status)
    || status < FIRST_HTTP_STATUS
    || status > LAST_HTTP_STATUS
  ) {
    return ''
  }

  const safeReason = sanitizeDriveReason(reason)

  return safeReason
    ? ` (Google answered ${status}, reason ${safeReason}.)`
    : ` (Google answered ${status}.)`
}

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

function firstReason(entries: unknown): unknown {
  if (!Array.isArray(entries)) {
    return undefined
  }

  for (const entry of entries) {
    if (isRecord(entry) && typeof entry.reason === 'string') {
      return entry.reason
    }
  }

  return undefined
}

/**
 * The reason Google reported, for the failure sentence and the logs: the
 * first `error.errors[].reason`, else the first `error.details[].reason`,
 * kept only when `sanitizeDriveReason` accepts it.
 */
export function readReportedDriveReason(
  body: Record<string, unknown> | null,
): string | null {
  const error = body?.error

  if (!isRecord(error)) {
    return null
  }

  return sanitizeDriveReason(
    firstReason(error.errors) ?? firstReason(error.details),
  )
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

    if (!response.ok) {
      return {
        ok: false,
        code: classifyDriveWriteFailure(
          response.status,
          readDriveReason(response.body),
        ),
        status: response.status,
        reason: readReportedDriveReason(response.body),
      }
    }

    if (!response.body) {
      return { ok: false, code: 'failed' }
    }

    return { ok: true, value: response.body }
  } catch (exception) {
    return { ok: false, code: classifyException(exception) }
  }
}

function isBoundaryItemId(value: string): boolean {
  return isDriveRootAlias(value) || isDriveWriteId(value)
}

function driveItemUrl(itemId: string, query: Record<string, string>): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(itemId)}?${
    new URLSearchParams(query).toString()}`
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
  id: string | null
  approvalDigest: string
}

/**
 * The metadata body of one create, copied field by field: a name, a media
 * type, at most one parent, the id that `generateDriveId` returned (none for
 * a converted upload, which Drive refuses an id for) and one app property.
 * Nothing else can be in it, whatever object the caller passes: no
 * permissions, no description, no sharing flags, no shortcut details. A
 * missing parent sends no `parents`, which means My Drive.
 */
export function buildDriveCreateMetadata(
  input: DriveCreateMetadataInput,
): Record<string, unknown> {
  return {
    ...(input.id ? { id: input.id } : {}),
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
  canRename: boolean | null
  canMoveItemWithinDrive: boolean | null
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
    canRename: booleanOrNull(capabilities?.canRename),
    canMoveItemWithinDrive: booleanOrNull(
      capabilities?.canMoveItemWithinDrive,
    ),
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
    driveItemUrl(itemId, {
      supportsAllDrives: 'true',
      fields: ITEM_META_FIELDS,
    }),
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const meta = readItemMeta(result.value)

  return meta ? { ok: true, value: meta } : { ok: false, code: 'failed' }
}

export const ANCESTOR_FIELDS = 'id,parents,shared,driveId,ownedByMe,trashed'

/**
 * `files.get` of one ancestor folder with the smallest field mask the
 * ancestry walk needs: its id and parents, whether it is shared, in a shared
 * drive, owned by the user and in the trash. A missing field stays unknown
 * and the caller refuses on it.
 */
export async function readDriveAncestor(
  folderId: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<DriveItemMeta>> {
  if (!isDriveWriteId(folderId)) {
    return { ok: false, code: 'bad_request' }
  }

  const result = await requestJson(
    driveItemUrl(folderId, {
      supportsAllDrives: 'true',
      fields: ANCESTOR_FIELDS,
    }),
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const meta = readItemMeta(result.value)

  return meta ? { ok: true, value: meta } : { ok: false, code: 'failed' }
}

const LOOKUP_DIGEST_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const LOOKUP_FIELDS = 'files(id,name,mimeType,parents,appProperties)'
const LOOKUP_PAGE_SIZE = 2

/**
 * The items that carry one retry marker (`appProperties.besidkaApproval`),
 * not in the trash, at most two. It is the retry protection of a converted
 * create, which has no client id: one hit is the earlier run's file, none
 * means nothing was created yet, two are ambiguous. The digest must be a
 * base64url value of 16 to 64 characters, so it cannot carry query syntax,
 * and an answer that holds an item without a Drive id shape fails. It is a
 * GET on the files endpoint; Drive's property search can lag for a file made
 * a moment ago, which the approval claim covers.
 */
export async function findDriveItemsByApprovalDigest(
  digest: string,
  context: DriveWriteContext,
): Promise<DriveWriteResult<DriveItemMeta[]>> {
  if (typeof digest !== 'string' || !LOOKUP_DIGEST_PATTERN.test(digest)) {
    return { ok: false, code: 'bad_request' }
  }

  const result = await requestJson(
    `${DRIVE_FILES_URL}?${new URLSearchParams({
      q: `appProperties has { key='${APPROVAL_PROPERTY}' and value='${
        escapeDriveQueryText(digest)}' } and trashed=false`,
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: LOOKUP_FIELDS,
      pageSize: String(LOOKUP_PAGE_SIZE),
    }).toString()}`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {}),
  )

  if (!result.ok) {
    return result
  }

  const files = result.value.files

  if (!Array.isArray(files)) {
    return { ok: false, code: 'failed' }
  }

  const items = files.map((file) => {
    return isRecord(file) ? readItemMeta(file) : null
  })

  return items.every(item => item !== null)
    ? { ok: true, value: items }
    : { ok: false, code: 'failed' }
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

export interface DriveMultipartBody {
  contentType: string
  data: Uint8Array<ArrayBuffer>
}

function newMultipartBoundary(): string {
  return `besidka-${crypto.randomUUID().replaceAll('-', '')}`
}

/**
 * The `multipart/related` body of one file create: the JSON metadata part,
 * then the content part with the given media type. A random boundary is
 * drawn again when the content or the metadata holds it, and after three
 * tries the body is refused (null), so the content can never end its own
 * part and add another.
 */
export function buildDriveCreateMultipart(input: {
  metadata: Record<string, unknown>
  uploadMimeType: string
  content: string
}): DriveMultipartBody | null {
  const metadataJson = JSON.stringify(input.metadata)
  const encoder = new TextEncoder()

  for (let attempt = 0; attempt < BOUNDARY_ATTEMPTS; attempt += 1) {
    const boundary = newMultipartBoundary()

    if (metadataJson.includes(boundary) || input.content.includes(boundary)) {
      continue
    }

    const head = encoder.encode(
      `--${boundary}\r\n`
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + `${metadataJson}\r\n`
      + `--${boundary}\r\n`
      + `Content-Type: ${input.uploadMimeType}; charset=UTF-8\r\n\r\n`,
    )
    const body = encoder.encode(input.content)
    const tail = encoder.encode(`\r\n--${boundary}--`)
    const data = new Uint8Array(
      head.byteLength + body.byteLength + tail.byteLength,
    )

    data.set(head, 0)
    data.set(body, head.byteLength)
    data.set(tail, head.byteLength + body.byteLength)

    return { contentType: `multipart/related; boundary=${boundary}`, data }
  }

  return null
}

export interface DriveCreateFileInput {
  id: string | null
  name: string
  kind: DriveFileKind
  content: string
  parentId: string | null
  approvalDigest: string
}

/**
 * `files.create` with a multipart upload (a file with content). The one
 * request to the upload endpoint, a POST to
 * `/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, never
 * a PATCH (which would replace content). Every field is read once into a
 * local and checked: the id and the parent have the shape of a Drive id, the
 * digest is a base64url SHA-256, and the name, kind and content pass
 * `validateCreateFileInput` again, so the body is built from checked values
 * only. The media types come from the kind map, never from the caller. A
 * converted kind (a Doc or a Sheet) must come with no id, a plain text file
 * with a Drive id: Drive answers `generatedIdNotSupported` for the first.
 */
export async function createDriveFileWithContent(
  input: DriveCreateFileInput,
  context: DriveWriteContext,
): Promise<DriveWriteResult<CreatedDriveItem>> {
  const id: unknown = input.id
  const name: unknown = input.name
  const kind: unknown = input.kind
  const content: unknown = input.content
  const parentId: unknown = input.parentId
  const approvalDigest: unknown = input.approvalDigest
  const hasParent = parentId !== null

  if (
    (id !== null && !isDriveWriteId(id))
    || (hasParent && !isDriveWriteId(parentId))
    || typeof approvalDigest !== 'string'
    || !APPROVAL_DIGEST_PATTERN.test(approvalDigest)
  ) {
    return { ok: false, code: 'bad_request' }
  }

  const request = validateCreateFileInput({
    name,
    kind,
    content,
    ...(hasParent ? { folderId: parentId } : {}),
  })

  if (!request.ok) {
    return { ok: false, code: 'bad_request' }
  }

  const isConverted = isDriveConvertedKind(request.value.kind)

  if (isConverted === (id !== null)) {
    return { ok: false, code: 'bad_request' }
  }

  const spec = GOOGLE_DRIVE_FILE_KIND_SPECS[request.value.kind]
  const multipart = buildDriveCreateMultipart({
    metadata: buildDriveCreateMetadata({
      id: id as string | null,
      name: request.value.name,
      mimeType: spec.targetMimeType,
      parentId: request.value.folderId,
      approvalDigest,
    }),
    uploadMimeType: spec.uploadMimeType,
    content: request.value.content,
  })

  if (!multipart) {
    return { ok: false, code: 'bad_request' }
  }

  const result = await requestJson(
    `${DRIVE_UPLOAD_URL}?${new URLSearchParams({
      uploadType: 'multipart',
      supportsAllDrives: 'true',
      fields: CREATED_FIELDS,
    }).toString()}`,
    {
      method: 'POST',
      headers: headersOf(context),
      rawBody: multipart,
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

export type DriveChangeOperation = 'rename' | 'move'

export const DRIVE_CHANGE_FAILURE_TEXT: Readonly<
  Record<DriveChangeOperation, Partial<Record<DriveWriteFailureCode, string>>>
> = {
  rename: {
    no_access: 'Google Drive did not allow renaming this item. The user may '
      + 'have no permission to change it, or Besidka needs the Change files '
      + 'access in the Besidka settings. Nothing was renamed.',
    not_found: 'Google Drive could not find that item, or the user has no '
      + 'access to it. Nothing was renamed.',
    bad_request: 'Google Drive refused the new name. Nothing was renamed.',
    failed: 'Google Drive did not confirm the rename, so it may or may not '
      + 'have happened. Ask the user to check the name in their Google Drive '
      + 'before trying again.',
  },
  move: {
    no_access: 'Google Drive did not allow moving this item. The user may '
      + 'have no permission to move it or to add to that folder, or Besidka '
      + 'needs the Change files access in the Besidka settings. Nothing was '
      + 'moved.',
    not_found: 'Google Drive could not find the item or one of the folders, '
      + 'or the user has no access to them. Nothing was moved.',
    bad_request: 'Google Drive refused the move. Nothing was moved.',
    failed: 'Google Drive did not confirm the move, so it may or may not have '
      + 'happened. Ask the user to check the folder in their Google Drive '
      + 'before trying again.',
  },
}

export interface DrivePatchRequest {
  itemId: string
  query: Record<string, string>
  body: Record<string, unknown>
}

function patchQuery(extra: Record<string, string>): Record<string, string> {
  return { ...extra, supportsAllDrives: 'true', fields: CREATED_FIELDS }
}

/**
 * The request that renames one item: the id in the URL path, only the
 * `supportsAllDrives` and `fields` query keys, and a body of exactly
 * `{ name }`. Nothing else can be in it, whatever object the caller passes.
 */
export function buildDriveRenameRequest(input: {
  itemId: string
  name: string
}): DrivePatchRequest {
  return {
    itemId: input.itemId,
    query: patchQuery({}),
    body: { name: input.name },
  }
}

/**
 * The request that moves one item from one parent to another: the id in the
 * URL path, only the query keys `addParents`, `removeParents`,
 * `supportsAllDrives` and `fields`, and an empty body. Both parents are real
 * Drive ids; the caller resolves the `root` alias to the id of My Drive.
 */
export function buildDriveMoveRequest(input: {
  itemId: string
  fromParentId: string
  toParentId: string
}): DrivePatchRequest {
  return {
    itemId: input.itemId,
    query: patchQuery({
      addParents: input.toParentId,
      removeParents: input.fromParentId,
    }),
    body: {},
  }
}

const RENAME_QUERY_KEYS: readonly string[] = ['fields', 'supportsAllDrives']
const MOVE_QUERY_KEYS: readonly string[] = [
  'addParents',
  'fields',
  'removeParents',
  'supportsAllDrives',
]

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()

  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A copy of a request that is exactly a rename (a body of only a valid
 * `name`, and the query keys `fields` and `supportsAllDrives`) or exactly a
 * move (an empty body, and the query keys `addParents`, `removeParents`,
 * `fields` and `supportsAllDrives`, with two different Drive ids), or null.
 * Every value is read once into a local and the copy is built from those
 * locals, so an object whose getters answer differently the second time
 * cannot pass the check with one value and send another. Whatever the
 * caller built by hand, no other body key and no other query key (an
 * upper-case `AddParents`, an own `__proto__` key) reaches Drive.
 */
function snapshotPatchRequest(request: DrivePatchRequest): {
  itemId: string
  query: Record<string, string>
  body: Record<string, unknown>
} | null {
  const itemId: unknown = request.itemId
  const query: unknown = request.query
  const body: unknown = request.body

  if (
    !isDriveWriteId(itemId)
    || !isPlainRecord(query)
    || !isPlainRecord(body)
  ) {
    return null
  }

  const supportsAllDrives = query.supportsAllDrives
  const fields = query.fields

  if (supportsAllDrives !== 'true' || fields !== CREATED_FIELDS) {
    return null
  }

  if (hasExactKeys(body, ['name'])) {
    const name = validateDriveItemName(body.name)

    return name.ok && hasExactKeys(query, RENAME_QUERY_KEYS)
      ? {
        itemId,
        query: { supportsAllDrives, fields },
        body: { name: name.value },
      }
      : null
  }

  if (!hasExactKeys(body, []) || !hasExactKeys(query, MOVE_QUERY_KEYS)) {
    return null
  }

  const addParents = query.addParents
  const removeParents = query.removeParents

  return isDriveWriteId(addParents)
    && isDriveWriteId(removeParents)
    && addParents !== removeParents
    ? {
      itemId,
      query: { addParents, removeParents, supportsAllDrives, fields },
      body: {},
    }
    : null
}

/**
 * The one PATCH of this module, on `/drive/v3/files/<id>` only (never the
 * upload endpoint, which would edit content): a rename or a move built by
 * `buildDriveRenameRequest` or `buildDriveMoveRequest`. The request is
 * checked and copied by `snapshotPatchRequest`, and the URL and the body are
 * built from the copy only.
 */
export async function patchDriveItem(
  request: DrivePatchRequest,
  context: DriveWriteContext,
): Promise<DriveWriteResult<CreatedDriveItem>> {
  const snapshot = snapshotPatchRequest(request)

  if (!snapshot) {
    return { ok: false, code: 'bad_request' }
  }

  const result = await requestJson(
    driveItemUrl(snapshot.itemId, snapshot.query),
    {
      method: 'PATCH',
      headers: headersOf(context),
      rawBody: {
        contentType: 'application/json',
        data: new TextEncoder().encode(
          JSON.stringify(snapshot.body),
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
