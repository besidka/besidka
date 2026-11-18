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

export const CONNECTOR_TOOL_APPROVALS = [
  'ask',
  'always',
  'needs-approval',
] as const

export const CONNECTOR_TOOL_MODES = ['manual', 'auto', 'always-on'] as const

/**
 * The mode of a connector whose `tool_mode` was never set (every connector
 * added before C-15 modes existed). Owner decision of 2026-11-16: Auto.
 */
export const CONNECTOR_UNSET_TOOL_MODE: ConnectorToolMode = 'auto'

export const CONNECTOR_NEW_TOOL_MODE: ConnectorToolMode = 'auto'

export function resolveConnectorToolMode(value: unknown): ConnectorToolMode {
  return CONNECTOR_TOOL_MODES.find(mode => mode === value)
    ?? CONNECTOR_UNSET_TOOL_MODE
}

export const CONNECTOR_TOOL_MODE_LABELS: Record<ConnectorToolMode, string> = {
  'manual': 'Manual',
  'auto': 'Auto',
  'always-on': 'Always on',
}

export const CONNECTOR_TOOL_MODE_DESCRIPTIONS: Record<
  ConnectorToolMode,
  string
> = {
  'manual': 'Used only in chats where you turn it on.',
  'auto': 'Available in every chat. The model uses it when a request needs '
    + 'it.',
  'always-on': 'The model gets its tools with every message in every chat, '
    + 'as many as fit.',
}

export const CONNECTOR_AUDIT_OUTCOMES = [
  'ok',
  'error',
  'denied',
  'timeout',
  'pending',
] as const

export const CONNECTOR_AUDIT_APPROVALS = [
  'not-applicable',
  'pending',
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
export type ConnectorToolMode = typeof CONNECTOR_TOOL_MODES[number]
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
export const CONNECTOR_TOOL_DEFINITIONS_MAX_BYTES = 32 * KIBIBYTE
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
export const CONNECTOR_LIST_TIMEOUT_MS = 8 * SECOND_MS
export const CONNECTOR_PREPARE_DEADLINE_MS = 8 * SECOND_MS
export const CONNECTOR_SSE_PER_SEND = 2
export const CONNECTOR_STEPS_PER_TURN = 4
export const CONNECTOR_CALLS_PER_TURN = 12
export const CONNECTOR_CALLS_PER_MINUTE = 60
export const CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR = 30
export const CONNECTOR_ICON_MAX_BYTES = 32 * KIBIBYTE
export const CONNECTOR_ICON_TIMEOUT_MS = 5 * SECOND_MS
export const CONNECTOR_ICON_TTL_SECONDS = 7 * 24 * HOUR_SECONDS
export const CONNECTOR_ICON_MISS_TTL_SECONDS = 24 * HOUR_SECONDS
export const CONNECTOR_ICON_MAX_DECLARED = 4
export const CONNECTOR_ICON_SOURCE_MAX_LENGTH = 64 * KIBIBYTE
export const CONNECTOR_ICON_CACHE_SECONDS = 24 * HOUR_SECONDS
export const CONNECTOR_ICON_MAX_DIMENSION = 512
export const CONNECTOR_ICON_ROUTES_PER_MINUTE = 300
export const CONNECTOR_ICON_LOCK_TTL_SECONDS = MINUTE_SECONDS
export const CONNECTOR_ICON_HTML_MAX_BYTES = 128 * KIBIBYTE
export const CONNECTOR_ICON_HTML_STREAM_MAX_BYTES = 4 * MEBIBYTE
export const CONNECTOR_ICON_HTML_LINKS = 3
export const CONNECTOR_ICON_RESOLVE_BUDGET_MS = 15 * SECOND_MS
export const SAFE_FETCH_OAUTH_MAX_BYTES = 256 * KIBIBYTE
export const SAFE_FETCH_REGISTRY_MAX_BYTES = 2 * MEBIBYTE
export const CONNECTOR_TOOLS_CACHE_TTL_SECONDS = 10 * MINUTE_SECONDS
export const CONNECTOR_TOOLS_CACHE_TTL_MIN_SECONDS = MINUTE_SECONDS
export const CONNECTOR_TOOLS_CACHE_TTL_MAX_SECONDS = HOUR_SECONDS
export const CONNECTOR_CATALOG_SNAPSHOT_TTL_SECONDS = 30 * 24 * HOUR_SECONDS
export const CONNECTOR_CATALOG_WARMUPS_PER_SEND = 2
export const CONNECTOR_CATALOG_WARMUP_BACKOFF_SECONDS = 15 * MINUTE_SECONDS
export const CONNECTOR_CATALOG_MAX_BYTES = 6 * KIBIBYTE
export const CONNECTOR_OAUTH_STATE_TTL_SECONDS = 10 * MINUTE_SECONDS
export const CONNECTOR_REFRESH_LOCK_TTL_SECONDS = 30
export const CONNECTOR_REFRESH_SKEW_SECONDS = 60
export const CONNECTOR_ROUTES_PER_MINUTE = 10
export const CONNECTOR_APPROVAL_TTL_SECONDS = 24 * HOUR_SECONDS
export const CONNECTOR_APPROVALS_PER_MINUTE = 30
export const CONNECTOR_APPROVALS_PER_SEND = 10
export const CONNECTOR_AUDIT_RETENTION_DAYS = 90
export const CONNECTOR_AUDIT_PRUNE_BATCH = 500
export const CONNECTOR_AUDIT_PRUNE_MAX_RUNTIME_MS = 20 * SECOND_MS
export const CONNECTOR_DRIFT_DIFF_LINES = 200
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 10 * SECOND_MS
export const SAFE_FETCH_DEFAULT_MAX_BYTES = 2 * MEBIBYTE
export const SAFE_FETCH_MAX_REDIRECTS = 3
export const SAFE_FETCH_CONNECTORS_USER_AGENT = 'Besidka-Connectors/1.0'
export const SAFE_FETCH_SKILLS_USER_AGENT = 'Besidka-Skills/1.0'
export const REGISTRY_SYNC_CRON = '7 * * * *'
export const REGISTRY_CURSOR_MAX_LENGTH = 512
export const REGISTRY_SWEEP_MAX_SHARE = 0.5
export const REGISTRY_PAGE_SIZE = 100
export const REGISTRY_PAGES_PER_RUN = 20
export const REGISTRY_FETCH_TIMEOUT_MS = 30 * SECOND_MS
export const REGISTRY_DESCRIPTION_MAX_CHARS = 300
export const REGISTRY_FULL_PASS_HOURS = 24
export const REGISTRY_SEARCH_PAGE_SIZE = 20
export const REGISTRY_SEARCHES_PER_MINUTE = 60
export const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io'
export const REGISTRY_SERVERS_PATH = '/v0.1/servers'
export const REGISTRY_RUN_BUDGET_MS = 4 * MINUTE_SECONDS * SECOND_MS
export const REGISTRY_SEARCH_MAX_CURSOR = 20_000
export const REGISTRY_SEARCH_QUERY_MIN_LENGTH = 2
export const REGISTRY_SYNC_NOW_LOCK_SECONDS = 150
export const REGISTRY_SYNC_NOW_MAX_PAGES = 20
export const REGISTRY_SEARCH_QUERY_MAX_LENGTH = 64
export const REGISTRY_NAME_MAX_LENGTH = 200
export const REGISTRY_TITLE_MAX_LENGTH = 120
export const REGISTRY_UPSERT_BATCH = 25
export const REGISTRY_PROBES_PER_MINUTE = 20
export const REGISTRY_PROBE_TTL_SECONDS = 24 * HOUR_SECONDS
export const REGISTRY_PROBE_MISS_TTL_SECONDS = HOUR_SECONDS
export const REGISTRY_PROBE_TIMEOUT_MS = 8 * SECOND_MS
export const REGISTRY_PROBE_MAX_TOOLS = 100
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
export const CONNECTOR_PAGE_PATH = '/chats/connectors'
export const CONNECTOR_CLIENT_METADATA_MAX_AGE_SECONDS = HOUR_SECONDS
export const CONNECTOR_CONSENT_VERSION = '2026-11-a'

/**
 * SHA-256 of the connector consent wording
 * (`app/components/Profile/Connectors/ConsentText.vue`, the
 * `data-connector-consent-text` spans, tags stripped, whitespace collapsed).
 * The spec `tests/unit/utils/connectors-consent-text.spec.ts` fails when the
 * wording changes, so a change cannot ship without a decision on
 * `CONNECTOR_CONSENT_VERSION`, whose bump asks again for every connector.
 */
export const CONNECTOR_CONSENT_TEXT_SHA256
  = 'fbe16d886c0f54dd87d6b335301a2df5b75c58bd00265fd1c8d89c4deb6ee63a'
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
export const CONNECTOR_SELECTION_WRITES_PER_MINUTE = 60
export const CONNECTOR_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const
export const CONNECTOR_IMAGES_PER_CALL = 4
export const CONNECTOR_IMAGE_MAX_BYTES = 3.5 * MEBIBYTE
export const CONNECTOR_IMAGES_MAX_BYTES_PER_SEND = 12 * MEBIBYTE

/**
 * Direct providers whose adapter sends an image inside a tool result as an
 * image block (Anthropic `tool_result` image, OpenAI Responses
 * `function_call_output` `input_image`). Other adapters, and every gateway,
 * may turn the same output into text, which would put the base64 into the
 * prompt, so their sends keep the text placeholder.
 */
export const CONNECTOR_IMAGE_PROVIDERS: readonly string[] = [
  'anthropic',
  'openai',
]

export type ConnectorImageMediaType
  = typeof CONNECTOR_IMAGE_MEDIA_TYPES[number]

export function isConnectorImageMediaType(
  value: unknown,
): value is ConnectorImageMediaType {
  return CONNECTOR_IMAGE_MEDIA_TYPES.some(mediaType => mediaType === value)
}

/**
 * Whether a send may show images from connector results to its model: only
 * on a direct (not gateway) allowlisted provider whose model takes image
 * input.
 */
export function canForwardConnectorImages(input: {
  gatewayId?: string | null
  providerId?: string | null
  inputModalities?: readonly string[] | null
}): boolean {
  return !input.gatewayId
    && !!input.providerId
    && CONNECTOR_IMAGE_PROVIDERS.includes(input.providerId)
    && !!input.inputModalities?.includes('image')
}
