export const PROTOCOL_VERSION = 1

export const CONNECT_MESSAGE_TYPE = 'besidka/connect'

export const RUNTIME_DOCUMENT_PATH = '/v1/index.html'

export const REQUEST_TIMEOUT_MS = 30_000

export const INTERACTIVE_REQUEST_TIMEOUT_MS = 300_000

export const MAX_PENDING_REQUESTS = 64

export const MAX_INBOUND_PENDING_REQUESTS = 16

export const MAX_FRAME_HEIGHT = 100_000

export const MAX_COMPLETE_OUTPUT_TOKENS = 2_000

export const MAX_STORAGE_VALUE_BYTES = 100_000

export const MAX_JSON_NODES = 10_000

export const MAX_JSON_DEPTH = 32

export const CONNECT_TIMEOUT_MS = 15_000

export const MAX_LOG_MESSAGE_LENGTH = 2_000

export const MAX_LINK_URL_LENGTH = 2_048

export const MAX_STORAGE_KEY_LENGTH = 256

export const MAX_COMPLETE_PROMPT_LENGTH = 8_000

export const MAX_CLIPBOARD_TEXT_LENGTH = 512 * 1024

export const MAX_DIAGRAM_SOURCE_LENGTH = 64 * 1024

export const CLIPBOARD_WRITE_LIMIT = { count: 5, windowMs: 10_000 } as const

export const DISPLAY_REQUEST_LIMIT = { count: 2, windowMs: 1_000 } as const

export const ARTIFACT_KINDS = [
  'html',
  'react',
  'svg',
  'mermaid',
  'markdown',
] as const

export const THEMES = ['light', 'dark'] as const

export const DISPLAY_MODES = ['inline', 'panel', 'fullscreen'] as const

export const REQUESTABLE_DISPLAY_MODES = ['panel', 'fullscreen'] as const

export const CLIPBOARD_MIME_TYPES = ['text/plain'] as const

export const CLIPBOARD_FAILURE_REASONS = [
  'gesture-required',
  'denied',
  'unavailable',
] as const

export const STORAGE_MODES = ['persistent', 'memory'] as const

export const LOG_LEVELS = ['error', 'warning'] as const

export const METHODS = {
  initialize: 'ui/initialize',
  initialized: 'ui/notifications/initialized',
  toolInputPartial: 'ui/notifications/tool-input-partial',
  toolResult: 'ui/notifications/tool-result',
  hostContextChanged: 'ui/notifications/host-context-changed',
  sizeChanged: 'ui/notifications/size-changed',
  openLink: 'ui/open-link',
  clipboardWrite: 'ui/clipboard-write',
  requestDisplayMode: 'ui/request-display-mode',
  openDiagramViewer: 'besidka/open-diagram-viewer',
  message: 'notifications/message',
  storageGet: 'besidka/storage/get',
  storageSet: 'besidka/storage/set',
  storageDelete: 'besidka/storage/delete',
  storageList: 'besidka/storage/list',
  complete: 'besidka/complete',
} as const

export const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  requestTimeout: -32001,
  connectionClosed: -32002,
  consentRequired: -32010,
  declinedByViewer: -32011,
  rateLimited: -32012,
  notAllowed: -32013,
} as const
