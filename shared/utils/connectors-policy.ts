const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE
const SECOND_MS = 1000
const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS

export const CONNECTOR_TRANSPORTS = ['streamable-http', 'sse'] as const

export const CONNECTOR_AUTH_TYPES = ['none', 'oauth', 'header'] as const

export const CONNECTOR_STATUSES = [
  'needs-auth',
  'ready',
  'drifted',
  'error',
] as const

export const CONNECTOR_CREATED_VIA = [
  'app',
  'preset',
  'registry',
  'mcp',
] as const

export const CONNECTOR_REGISTRATION_KINDS = ['cimd', 'dcr'] as const

export const CONNECTOR_TOOL_APPROVALS = ['ask', 'always'] as const

export const CONNECTOR_AUDIT_OUTCOMES = [
  'ok',
  'error',
  'denied',
  'timeout',
  'pending',
] as const

export const CONNECTOR_AUDIT_APPROVALS = [
  'not-applicable',
  'once',
  'chat',
  'always',
  'denied',
] as const

export const CONNECTOR_AUDIT_PATHS = ['worker', 'native'] as const

export const CONNECTOR_REGISTRY_REMOTE_TYPES = ['streamable-http'] as const

export type ConnectorTransport = typeof CONNECTOR_TRANSPORTS[number]
export type ConnectorAuthType = typeof CONNECTOR_AUTH_TYPES[number]
export type ConnectorStatus = typeof CONNECTOR_STATUSES[number]
export type ConnectorCreatedVia = typeof CONNECTOR_CREATED_VIA[number]
export type ConnectorRegistrationKind
  = typeof CONNECTOR_REGISTRATION_KINDS[number]
export type ConnectorToolApproval = typeof CONNECTOR_TOOL_APPROVALS[number]
export type ConnectorAuditOutcome = typeof CONNECTOR_AUDIT_OUTCOMES[number]
export type ConnectorAuditApproval = typeof CONNECTOR_AUDIT_APPROVALS[number]
export type ConnectorAuditPath = typeof CONNECTOR_AUDIT_PATHS[number]

export const CONNECTOR_URL_MAX_LENGTH = 2048
export const CONNECTOR_ALLOWED_PORTS: readonly number[] = [443, 8443]
export const CONNECTOR_HEADER_VALUE_MAX_BYTES = 4096
export const CONNECTOR_HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/
export const CONNECTOR_REJECTED_HEADER_NAMES: readonly string[] = [
  'host',
  'cookie',
  'content-length',
  'transfer-encoding',
  'connection',
  'mcp-session-id',
  'mcp-protocol-version',
]
export const CONNECTORS_PER_USER = 20
export const CONNECTORS_MCP_DISABLED_MAX = 5
export const CONNECTORS_PER_SEND = 5
export const CONNECTOR_TOOLS_PER_REQUEST = 40
export const CONNECTOR_TOOL_DESCRIPTIONS_MAX_BYTES = 16 * KIBIBYTE
export const CONNECTOR_TOOL_DESCRIPTION_MAX_BYTES = KIBIBYTE
export const CONNECTOR_TOOL_SCHEMA_MAX_BYTES = 8 * KIBIBYTE
export const CONNECTOR_TOOL_NAME_MAX_LENGTH = 64
export const CONNECTOR_SLUG_MAX_LENGTH = 16
export const CONNECTOR_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/
export const CONNECTOR_TITLE_MAX_LENGTH = 80
export const CONNECTOR_RESULT_MAX_BYTES = 64 * KIBIBYTE
export const CONNECTOR_RESPONSE_MAX_BYTES = MEBIBYTE
export const CONNECTOR_CALL_TIMEOUT_MS = 60 * SECOND_MS
export const CONNECTOR_CONNECT_TIMEOUT_MS = 10 * SECOND_MS
export const CONNECTOR_PARALLEL_CONNECTS = 3
export const CONNECTOR_STEPS_PER_TURN = 4
export const CONNECTOR_CALLS_PER_TURN = 12
export const CONNECTOR_CALLS_PER_MINUTE = 60
export const CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR = 30
export const SAFE_FETCH_OAUTH_MAX_BYTES = 256 * KIBIBYTE
export const SAFE_FETCH_REGISTRY_MAX_BYTES = 2 * MEBIBYTE
export const CONNECTOR_TOOLS_CACHE_TTL_SECONDS = 10 * MINUTE_SECONDS
export const CONNECTOR_TOOLS_CACHE_TTL_MIN_SECONDS = MINUTE_SECONDS
export const CONNECTOR_TOOLS_CACHE_TTL_MAX_SECONDS = HOUR_SECONDS
export const CONNECTOR_OAUTH_STATE_TTL_SECONDS = 10 * MINUTE_SECONDS
export const CONNECTOR_REFRESH_LOCK_TTL_SECONDS = 30
export const CONNECTOR_REFRESH_SKEW_SECONDS = 60
export const CONNECTOR_ROUTES_PER_MINUTE = 10
export const CONNECTOR_APPROVAL_TTL_SECONDS = 24 * HOUR_SECONDS
export const CONNECTOR_APPROVALS_PER_MINUTE = 30
export const CONNECTOR_APPROVALS_PER_SEND = 10
export const CONNECTOR_AUDIT_RETENTION_DAYS = 90
export const CONNECTOR_AUDIT_PRUNE_BATCH = 500
export const CONNECTOR_DRIFT_DIFF_LINES = 200
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 10 * SECOND_MS
export const SAFE_FETCH_DEFAULT_MAX_BYTES = 2 * MEBIBYTE
export const SAFE_FETCH_MAX_REDIRECTS = 3
export const SAFE_FETCH_CONNECTORS_USER_AGENT = 'Besidka-Connectors/1.0'
export const SAFE_FETCH_SKILLS_USER_AGENT = 'Besidka-Skills/1.0'
export const REGISTRY_SYNC_CRON = '0 * * * *'
export const REGISTRY_PAGE_SIZE = 100
export const REGISTRY_PAGES_PER_RUN = 20
export const REGISTRY_FETCH_TIMEOUT_MS = 30 * SECOND_MS
export const REGISTRY_DESCRIPTION_MAX_CHARS = 300
export const REGISTRY_FULL_PASS_HOURS = 24
export const REGISTRY_SEARCH_PAGE_SIZE = 20
export const REGISTRY_SEARCHES_PER_MINUTE = 30
export const CONNECTOR_MCP_DELETE_BATCH = 20
export const CONNECTOR_MCP_TOOLS_BATCH = 100
export const CONNECTOR_MCP_LIST_LIMIT = 50
export const CONNECTOR_KV_MIN_TTL_SECONDS = 60
export const CONNECTOR_REFRESH_LOCK_WAIT_MS = 500
export const CONNECTOR_REFRESH_LOCK_WAIT_ATTEMPTS = 3
export const CONNECTOR_REQUEST_BODY_MAX_BYTES = 8 * KIBIBYTE
export const CONNECTOR_DELETE_BATCH = 20
export const CONNECTOR_REVOKE_TIMEOUT_MS = 3 * SECOND_MS
export const CONNECTOR_REVOKE_DEADLINE_MS = 10 * SECOND_MS
export const CONNECTOR_OAUTH_STATE_MAX_LENGTH = 128
export const CONNECTOR_OAUTH_CODE_MAX_LENGTH = 2048
export const CONNECTOR_SCOPE_MAX_LENGTH = 1024
export const CONNECTOR_ISSUER_HOST_MAX_LENGTH = 253
export const CONNECTOR_CLIENT_METADATA_PATH = '/connectors/client-metadata.json'
export const CONNECTOR_OAUTH_CALLBACK_PATH = '/api/v1/connectors/oauth/callback'
export const CONNECTOR_PAGE_PATH = '/profile/connectors'
export const CONNECTOR_CLIENT_METADATA_MAX_AGE_SECONDS = HOUR_SECONDS
export const CONNECTOR_CONSENT_VERSION = '2026-11-a'
export const CONNECTOR_CONSENT_ERROR_CODE = 'CONNECTOR_CONSENT_REQUIRED'
export const CONNECTOR_CALLBACK_FAILURES_MAX = 20
export const CONNECTOR_CALLBACK_FAILURE_WINDOW_SECONDS = 10 * MINUTE_SECONDS
export const CONNECTOR_REVOKE_CONCURRENCY = 4
export const CONNECTOR_TOOL_NAME_PREFIX = 'mcp__'
export const CONNECTOR_RESULT_TAG = 'untrusted_tool_result'
export const CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH = 128
export const CONNECTOR_LISTED_TOOLS_MAX = 200
export const CONNECTOR_LIST_PAGES_MAX = 10
export const CONNECTOR_CLOSE_TIMEOUT_MS = 2 * SECOND_MS
export const CONNECTOR_SSE_SESSION_TIMEOUT_MS = 540 * SECOND_MS
export const CONNECTOR_SSE_SESSION_MAX_BYTES = 8 * MEBIBYTE
export const CONNECTOR_RATE_LIMIT_WINDOW_SECONDS = 60
export const CONNECTOR_AUDIT_ARGS_HKDF_INFO = 'besidka/connector-audit-args/v1'
