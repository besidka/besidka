const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS

export const TOOL_FAMILIES = [
  'native',
  'besidka',
  'connector',
  'google',
] as const

export const TOOL_ACCESS_LEVELS = [
  'read',
  'write',
  'delete',
  'instructions',
] as const

export const TOOL_PERMISSION_MODES = ['blocked', 'ask', 'allow'] as const

export const TOOL_APPROVAL_TAINT_KINDS = [
  'web',
  'connector',
  'skill',
  'knowledge',
  'file',
  'besidka',
  'shared-branch',
  'google',
] as const

export const TOOL_APPROVAL_STRICTEST_TAINT_KIND = 'google'

export const TOOL_APPROVAL_REASONS = [
  'untrusted-output',
  'cross-source',
  'always-ask',
  'consent',
  'default',
  'google-egress',
] as const

export const TOOL_APPROVAL_REMEMBER_OPTIONS = [
  'once',
  'chat',
  'always',
] as const

export const TOOL_APPROVAL_CLAIM_STATUSES = [
  'claimed',
  'done',
  'failed',
] as const

export const TOOL_APPROVAL_DENIAL_REASONS = [
  'blocked',
  'missing-tool',
  'definition-drifted',
  'over-cap',
  'invalid-input',
] as const

export type ToolFamily = typeof TOOL_FAMILIES[number]
export type ToolAccess = typeof TOOL_ACCESS_LEVELS[number]
export type ToolPermissionMode = typeof TOOL_PERMISSION_MODES[number]
export type ToolApprovalTaintKind = typeof TOOL_APPROVAL_TAINT_KINDS[number]
export type ToolApprovalReason = typeof TOOL_APPROVAL_REASONS[number]
export type ToolApprovalRemember
  = typeof TOOL_APPROVAL_REMEMBER_OPTIONS[number]
export type ToolApprovalClaimStatus
  = typeof TOOL_APPROVAL_CLAIM_STATUSES[number]
export type ToolApprovalDenialReason
  = typeof TOOL_APPROVAL_DENIAL_REASONS[number]

export const TOOL_APPROVAL_RECORD_VERSION = 1
export const TOOL_APPROVAL_TTL_SECONDS = 24 * HOUR_SECONDS
export const TOOL_APPROVAL_SECRET_HKDF_INFO = 'besidka/tool-approval/v1'
export const TOOL_APPROVAL_PAYLOAD_MAX_BYTES = 64 * 1024
export const TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS = 200
export const TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES = 100
export const TOOL_APPROVAL_CHAT_INDEX_MAX_RESULTS = 200
export const TOOL_APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
export const TOOL_APPROVAL_SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const TOOL_APPROVAL_KV_PREFIX = 'tool-approval:'
export const TOOL_APPROVAL_PENDING_PER_MESSAGE = 10
export const TOOL_APPROVAL_ROUNDS_PER_TURN = 5
export const TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN = 50
export const TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN = 12
export const TOOL_APPROVAL_RESPONSES_PER_MINUTE = 30
export const TOOL_APPROVAL_SUMMARY_MAX_LENGTH = 1000
export const TOOL_APPROVAL_PREVIEW_MAX_LENGTH = 20_000
export const TOOL_APPROVAL_READ_SOURCES_MAX = 64
export const TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH = 80
export const TOOL_APPROVAL_CLAIM_LEASE_SECONDS = 2 * MINUTE_SECONDS
export const TOOL_APPROVAL_CLAIM_RETENTION_HOURS = 48
export const TOOL_APPROVAL_CLAIM_SWEEP_BATCH = 500
export const TOOL_APPROVAL_CLAIM_SWEEP_MAX_BATCHES = 10
export const TOOL_APPROVAL_BESIDKA_READ_SOURCE = 'besidka'
export const TOOL_APPROVAL_GOOGLE_READ_SOURCE = 'google'
export const TOOL_APPROVAL_TAINT_KIND_MAX_LENGTH = 64
export const TOOL_APPROVAL_SERIALIZED_TAINT_MAX = 32
export const TOOL_APPROVAL_READ_SOURCE_OVERFLOW = 'overflow'
export const TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES = [
  'memory_write',
  'memory_forget',
] as const
export const TOOL_APPROVAL_CONNECTOR_READ_SOURCE_PREFIX = 'connector:'
export const TOOL_APPROVAL_REASON_MAX_LENGTH = 500
export const TOOL_APPROVAL_STALE_CODE = 'TOOL_APPROVAL_STALE'
export const TOOL_APPROVAL_EXPIRED_CODE = 'TOOL_APPROVAL_EXPIRED'
export const TOOL_APPROVAL_INTERRUPTED_CODE = 'TOOL_APPROVAL_INTERRUPTED'
export const TOOL_APPROVAL_CLAIM_HEARTBEAT_MS = 30_000
