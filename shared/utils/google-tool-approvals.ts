import { TOOL_APPROVAL_PAYLOAD_MAX_BYTES } from '#shared/utils/tool-approval-policy'

export const GOOGLE_TOOL_NAME_PREFIX = 'google__'

/**
 * The most a Google tool may return, measured as UTF-8 bytes of the
 * JSON-serialized output. A tool author caps the output here before
 * returning it: a paused turn keeps the body only in KV, and a body over
 * this size is not kept there, so the continuation sees only its
 * references (`stashGoogleToolResults`).
 */
export const GOOGLE_TOOL_OUTPUT_MAX_BYTES = TOOL_APPROVAL_PAYLOAD_MAX_BYTES

export const GOOGLE_EGRESS_GRANT_KEY_PREFIX = 'google-egress:'

export const GOOGLE_TOOL_KINDS = ['read', 'write'] as const

export type GoogleToolKind = typeof GOOGLE_TOOL_KINDS[number]

export const GOOGLE_EGRESS_REASON_TEXT = 'Content from Google in this chat '
  + 'may be sent to this connector'

export function isGoogleToolName(toolName: unknown): toolName is string {
  return typeof toolName === 'string'
    && toolName.startsWith(GOOGLE_TOOL_NAME_PREFIX)
    && toolName.length > GOOGLE_TOOL_NAME_PREFIX.length
}

/**
 * The key of a Google tool's "Allow in this chat" grant in
 * `besidka_chat_settings.alwaysAllowTools`: the exposed `google__` name, so
 * it can never collide with a Besidka (`besidka__`) or skill scripts key.
 */
export function googleChatGrantKey(toolName: string): string {
  return isGoogleToolName(toolName)
    ? toolName
    : `${GOOGLE_TOOL_NAME_PREFIX}${toolName}`
}

/**
 * The key of the Google egress grant of one connector tool in its
 * `connector_chat_settings.alwaysAllowTools`: it lets that tool run in a
 * chat that holds Google content, and nothing else.
 */
export function googleEgressGrantKey(exposedName: string): string {
  return `${GOOGLE_EGRESS_GRANT_KEY_PREFIX}${exposedName}`
}
