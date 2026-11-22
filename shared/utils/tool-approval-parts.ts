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

export interface ToolApprovalPartData {
  approvalId: string
  toolCallId: string
  toolName: string
  reason: ToolApprovalReason
  summary: string
  rememberOptions: ToolApprovalRemember[]
  preview?: string
  link?: string
}

const APPROVAL_LINK_MAX_LENGTH = 2048
const APPROVAL_LINK_HOSTS: ReadonlySet<string> = new Set([
  'mail.google.com',
  'drive.google.com',
  'docs.google.com',
])

/**
 * The one link an approval card may show next to its summary (the Gmail
 * thread or Drive file the call names): plain HTTPS on a Gmail or Google
 * Drive host, no credentials and no port. Anything else is null, on the
 * server before it is stored and in the browser before it is shown.
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

  return isPlainHttps && APPROVAL_LINK_HOSTS.has(url.hostname)
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
