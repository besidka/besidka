import type {
  ToolApprovalReason,
  ToolApprovalRemember,
} from '#shared/utils/tool-approval-policy'

export const TOOL_APPROVAL_DATA_PART_TYPE = 'data-tool-approval'
export const TOOL_GRANT_DATA_PART_TYPE = 'data-tool-grant'

export type ToolGrantScope = 'chat' | 'always'

/**
 * Written by the server after a call that ran without asking because of a
 * grant the user gave ("Allow in this chat" or "Always allow"), so the
 * reasoning step can say so. Private: shares and branches drop it.
 */
export interface ToolGrantPartData {
  toolCallId: string
  toolName: string
  scope: ToolGrantScope
}

export interface ToolGrantDataPart {
  type: typeof TOOL_GRANT_DATA_PART_TYPE
  id: string
  data: ToolGrantPartData
}

const AWAITING_APPROVAL_STATES = new Set<string>([
  'approval-requested',
  'approval-responded',
])

export interface DriveName {
  name: string
  id: string
}

export interface DriveNames {
  item?: DriveName
  from?: DriveName
  to?: DriveName
  folder?: DriveName
}

export interface ToolApprovalPartData {
  approvalId: string
  toolCallId: string
  toolName: string
  reason: ToolApprovalReason
  summary: string
  rememberOptions: ToolApprovalRemember[]
  preview?: string
  link?: string
  driveNames?: DriveNames
}

export const DRIVE_NAME_MAX_LENGTH = 200
const DRIVE_NAME_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/
const DRIVE_NAMES_KEYS: readonly (keyof DriveNames)[] = [
  'item',
  'from',
  'to',
  'folder',
]

function readDriveName(value: unknown): DriveName | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return null
  }

  const { name, id, ...rest } = value as Record<string, unknown>

  if (
    Object.keys(rest).length > 0
    || typeof name !== 'string'
    || !name
    || name.length > DRIVE_NAME_MAX_LENGTH
    || typeof id !== 'string'
    || !DRIVE_NAME_ID_PATTERN.test(id)
  ) {
    return null
  }

  return { name, id }
}

/**
 * The names a Drive approval card shows next to the ids of its input (the
 * folder a call names, the item it renames or moves), as the server wrote
 * them from the chat's own Drive results. Any shape other than an object of
 * the four known keys, each a name of 1 to 200 characters with the id it
 * stands for, is null, on the server before it is stored and in the browser
 * before it is shown, so a name is never shown beside an id it was not
 * written for.
 */
export function readApprovalDriveNames(value: unknown): DriveNames | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return null
  }

  const record = value as Record<string, unknown>
  const names: DriveNames = {}

  for (const key of Object.keys(record)) {
    if (!(DRIVE_NAMES_KEYS as readonly string[]).includes(key)) {
      return null
    }
  }

  for (const key of DRIVE_NAMES_KEYS) {
    if (record[key] === undefined) {
      continue
    }

    const driveName = readDriveName(record[key])

    if (!driveName) {
      return null
    }

    names[key] = driveName
  }

  return Object.keys(names).length > 0 ? names : null
}

const APPROVAL_LINK_MAX_LENGTH = 2048
const GMAIL_LINK_HOST = 'mail.google.com'
const GMAIL_LINK_PATH = '/mail/'
const GMAIL_LINK_QUERY_PATTERN = /^(?:\?authuser=[A-Za-z0-9._%+@-]{1,300})?$/
const GMAIL_LINK_HASH_PATTERN = /^#all\/[A-Za-z0-9_-]{1,64}$/
const DRIVE_LINK_HOST = 'drive.google.com'
const DRIVE_LINK_PATH = '/open'
const DRIVE_LINK_QUERY_PATTERN = /^\?id=[A-Za-z0-9_-]{10,128}$/

function isGmailThreadLink(url: URL): boolean {
  return url.hostname === GMAIL_LINK_HOST
    && url.pathname === GMAIL_LINK_PATH
    && GMAIL_LINK_QUERY_PATTERN.test(url.search)
    && GMAIL_LINK_HASH_PATTERN.test(url.hash)
}

function isDriveFileLink(url: URL): boolean {
  return url.hostname === DRIVE_LINK_HOST
    && url.pathname === DRIVE_LINK_PATH
    && DRIVE_LINK_QUERY_PATTERN.test(url.search)
    && url.hash === ''
}

/**
 * The one link an approval card may show next to its summary: plain HTTPS
 * with no credentials and no port, in exactly one of the two shapes the
 * server builds, the Gmail thread (`/mail/`, an optional `authuser` and
 * `#all/<thread id>`) or the Drive file (`/open?id=<file id>`). Any other
 * host, path, parameter or fragment is null, on the server before it is
 * stored and in the browser before it is shown.
 */
export function readApprovalLink(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length > APPROVAL_LINK_MAX_LENGTH
    || !URL.canParse(value)
  ) {
    return null
  }

  const url = new URL(value)
  const isPlainHttps = url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.port

  return isPlainHttps && (isGmailThreadLink(url) || isDriveFileLink(url))
    ? url.toString()
    : null
}

export interface ToolApprovalDataPart {
  type: typeof TOOL_APPROVAL_DATA_PART_TYPE
  id: string
  data: ToolApprovalPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToolPartType(type: unknown): boolean {
  return typeof type === 'string'
    && (type === 'dynamic-tool' || type.startsWith('tool-'))
}

/**
 * A tool part that waits for the user: the model asked to run it and the
 * user has not answered yet (`approval-requested`), or answered and the
 * continuation has not run it yet (`approval-responded`).
 */
export function isAwaitingApprovalToolPart(part: unknown): boolean {
  return isRecord(part)
    && isToolPartType(part.type)
    && typeof part.state === 'string'
    && AWAITING_APPROVAL_STATES.has(part.state)
}

export function isToolApprovalDataPart(
  part: unknown,
): part is ToolApprovalDataPart {
  return isRecord(part)
    && part.type === TOOL_APPROVAL_DATA_PART_TYPE
    && isRecord(part.data)
}

export function isToolGrantDataPart(
  part: unknown,
): part is ToolGrantDataPart {
  return isRecord(part)
    && part.type === TOOL_GRANT_DATA_PART_TYPE
    && isRecord(part.data)
    && typeof part.data.toolCallId === 'string'
    && (part.data.scope === 'chat' || part.data.scope === 'always')
}

/**
 * A part that only exists because a tool call waits for approval: the tool
 * part itself or the server-written `data-tool-approval` part next to it.
 */
export function isToolApprovalPart(part: unknown): boolean {
  return isAwaitingApprovalToolPart(part) || isToolApprovalDataPart(part)
}

/**
 * Whether the parts still hold a call that waits for the user, so the
 * answer is paused rather than empty.
 */
export function hasAwaitingApprovalToolPart(parts: unknown): boolean {
  return Array.isArray(parts) && parts.some(isAwaitingApprovalToolPart)
}

/**
 * A tool part that waits for approval, reduced for `messages.parts`: the
 * type, call id, state and approval id stay, the input is replaced by the
 * given summary fields, and the signature is never kept. The exact input
 * the user approves lives only in the pending KV record.
 */
export function toStoredAwaitingApprovalToolPart(
  part: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const approval = isRecord(part.approval) ? part.approval : {}

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: part.state,
    input,
    approval: {
      id: approval.id,
      ...(typeof approval.requestReason === 'string'
        ? { requestReason: approval.requestReason }
        : {}),
      ...(typeof approval.approved === 'boolean'
        ? { approved: approval.approved }
        : {}),
    },
  }
}
