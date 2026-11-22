import type {
  ConnectorCallErrorCategory,
} from '#shared/utils/connectors-errors'
import { redactSecrets } from '~~/server/utils/connectors/tool-definitions'

const CAUSE_DEPTH_MAX = 4
const LOGGED_MESSAGE_MAX_LENGTH = 300
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_CLIENT_ERROR_MIN = 400
const AUTH_ERROR_NAMES: readonly string[] = [
  'UnauthorizedError',
  'MCPClientOAuthError',
  'AuthorizationServerMismatchError',
]
const TIMEOUT_ERROR_NAMES: readonly string[] = ['TimeoutError']
const PROTOCOL_ERROR_NAMES: readonly string[] = [
  'ZodError',
  'AI_TypeValidationError',
  'AI_JSONParseError',
  'SyntaxError',
]
const AUTH_CODES: readonly string[] = [
  'CONNECTOR_REAUTH_REQUIRED',
  'CONNECTOR_CREDENTIALS_REJECTED',
  'CONNECTOR_AUTH_REQUIRED',
  'CONNECTOR_REFRESH_FAILED',
]
const UNREACHABLE_CODES: readonly string[] = [
  'CONNECTOR_UNREACHABLE',
  'CONNECTOR_ORIGIN_CHANGED',
]
const SAFE_FETCH_CODE_PREFIX = 'safe-fetch-'
const UNREACHABLE_SYSTEM_CODE = new RegExp(
  '^(?:ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|CERT_'
  + '|ERR_TLS|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|FailedToOpenSocket)',
)
const AUTH_MESSAGE = /unauthori[sz]ed|forbidden|authenticat|invalid[ _-]?(?:api[ _-]?key|token|credential)|expired[ _-]?token/i
const TIMEOUT_MESSAGE = /timed? ?out|timeout/i
const UNREACHABLE_MESSAGE = /connection closed|fetch failed|network|socket|dns|econn|not connected/i
const PROTOCOL_MESSAGE = /parse|invalid|unexpected|validation|schema|content type/i

export interface ClassifiedConnectorCallError {
  category: ConnectorCallErrorCategory
  httpStatus: number | null
  errorName: string
  code: string | null
  message: string
}

interface ErrorNode {
  name: string
  message: string
  code: string | number | null
  statusCode: number | null
}

function readNode(value: unknown): ErrorNode {
  const record = (typeof value === 'object' && value !== null
    ? value
    : {}) as Record<string, unknown>
  const code = record.code
  const statusCode = record.statusCode

  return {
    name: typeof record.name === 'string' ? record.name : typeof value,
    message: value instanceof Error
      ? value.message
      : typeof record.message === 'string'
        ? record.message
        : String(value),
    code: typeof code === 'string' || typeof code === 'number' ? code : null,
    statusCode: typeof statusCode === 'number' && typeof code !== 'string'
      ? statusCode
      : null,
  }
}

function collectChain(exception: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = []
  let current: unknown = exception

  for (let depth = 0; depth < CAUSE_DEPTH_MAX; depth++) {
    if (current === undefined || current === null) {
      break
    }

    nodes.push(readNode(current))
    current = (current as { cause?: unknown }).cause
  }

  return nodes
}

function categoryOfStringCode(
  code: string,
): ConnectorCallErrorCategory | null {
  if (code === 'safe-fetch-timeout' || code === 'ETIMEDOUT') {
    return 'timeout'
  }

  if (code === 'safe-fetch-too-large') {
    return 'protocol'
  }

  if (AUTH_CODES.includes(code)) {
    return 'auth'
  }

  if (
    code.startsWith(SAFE_FETCH_CODE_PREFIX)
    || UNREACHABLE_CODES.includes(code)
    || UNREACHABLE_SYSTEM_CODE.test(code)
  ) {
    return 'unreachable'
  }

  return null
}

function categoryOfStatus(
  statusCode: number,
): ConnectorCallErrorCategory | null {
  if (statusCode === HTTP_UNAUTHORIZED || statusCode === HTTP_FORBIDDEN) {
    return 'auth'
  }

  if (statusCode === HTTP_REQUEST_TIMEOUT) {
    return 'timeout'
  }

  if (statusCode === HTTP_TOO_MANY_REQUESTS) {
    return 'rate-limited'
  }

  if (statusCode >= HTTP_SERVER_ERROR_MIN) {
    return 'server-error'
  }

  return statusCode >= HTTP_CLIENT_ERROR_MIN ? 'protocol' : null
}

function categoryOfNodes(
  nodes: readonly ErrorNode[],
): ConnectorCallErrorCategory {
  for (const node of nodes) {
    const fromCode = typeof node.code === 'string'
      ? categoryOfStringCode(node.code)
      : null

    if (fromCode) {
      return fromCode
    }
  }

  if (nodes.some(node => AUTH_ERROR_NAMES.includes(node.name))) {
    return 'auth'
  }

  for (const node of nodes) {
    const fromStatus = node.statusCode === null
      ? null
      : categoryOfStatus(node.statusCode)

    if (fromStatus) {
      return fromStatus
    }
  }

  for (const node of nodes) {
    if (typeof node.code === 'number') {
      return AUTH_MESSAGE.test(node.message)
        ? 'auth'
        : TIMEOUT_MESSAGE.test(node.message) ? 'timeout' : 'protocol'
    }
  }

  const messages = nodes.map(node => node.message).join(' ')

  if (
    nodes.some(node => TIMEOUT_ERROR_NAMES.includes(node.name))
    || TIMEOUT_MESSAGE.test(messages)
  ) {
    return 'timeout'
  }

  if (UNREACHABLE_MESSAGE.test(messages)) {
    return 'unreachable'
  }

  if (
    nodes.some(node => PROTOCOL_ERROR_NAMES.includes(node.name))
    || PROTOCOL_MESSAGE.test(messages)
  ) {
    return 'protocol'
  }

  return 'unknown'
}

/**
 * Sorts a failure of a connector call into one fixed category. The checks run
 * in a fixed order: the string `code` of the error or any of its causes (the
 * connector and `safe-fetch-*` codes and the system network codes), the OAuth
 * error names, the HTTP status the MCP client carries, a JSON-RPC code, and
 * only then the error name and message. `timedOut` is the caller's own
 * deadline and wins over everything. The message is returned raw, for the
 * caller to redact, and is never shown to the model or the user.
 */
export function classifyConnectorCallError(
  exception: unknown,
  options?: { timedOut?: boolean },
): ClassifiedConnectorCallError {
  const nodes = collectChain(exception)
  const first = nodes[0] ?? readNode(exception)
  const httpStatus = nodes.find(node => node.statusCode !== null)?.statusCode
    ?? null
  const stringCode = nodes.find(node => typeof node.code === 'string')?.code
  const category = options?.timedOut ? 'timeout' : categoryOfNodes(nodes)

  return {
    category,
    httpStatus,
    errorName: first.name,
    code: typeof stringCode === 'string' ? stringCode : null,
    message: first.message,
  }
}

const URL_IN_TEXT = /https?:\/\/\S+/gi
const CONTROL_CHARACTERS = /\p{Cc}/gu
const LOGGED_IDENTIFIER_MAX_LENGTH = 64
const URL_REDACTION_MIN_LENGTH = 4

function pushRedaction(target: Set<string>, value: string): void {
  if (value.length >= URL_REDACTION_MIN_LENGTH) {
    target.add(value)
    target.add(encodeURIComponent(value))
    target.add(encodeURI(value))
  }
}

/**
 * The parts of a connector address that can carry a secret and are not part
 * of its origin: the path, the query, and each query value, in plain and
 * URL-encoded form. They are redacted from logged messages on top of the
 * credentials, because a server may echo the request address in an error.
 */
export function collectUrlRedactions(url: string): string[] {
  const redactions = new Set<string>()

  try {
    const parsed = new URL(url)
    const pathWithQuery = `${parsed.pathname}${parsed.search}`

    if (parsed.pathname !== '/') {
      pushRedaction(redactions, parsed.pathname)
    }

    if (parsed.search) {
      pushRedaction(redactions, pathWithQuery)
      pushRedaction(redactions, parsed.search.slice(1))
    }

    for (const value of parsed.searchParams.values()) {
      pushRedaction(redactions, value)
    }
  } catch {
    return []
  }

  return [...redactions]
}

/**
 * A value for a log field that is not free text: control characters removed
 * and cut to 64 characters.
 */
export function sanitizeLoggedIdentifier(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, '')
    .slice(0, LOGGED_IDENTIFIER_MAX_LENGTH)
}

/**
 * The remote error message as it may appear in a log: redacted of this
 * connector's secrets and address parts, every address replaced by `[url]`,
 * flattened to one line and cut to 300 characters.
 */
export function redactLoggedMessage(
  message: string,
  secrets: readonly string[],
): string {
  return redactSecrets(message, secrets)
    .replace(URL_IN_TEXT, '[url]')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LOGGED_MESSAGE_MAX_LENGTH)
}
