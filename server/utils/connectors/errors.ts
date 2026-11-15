import { createError } from 'evlog'
import { CONNECTOR_CONSENT_ERROR_CODE } from '#shared/utils/connectors-policy'

interface ConnectorErrorText {
  message: string
  status: number
  why: string
  fix: string
}

/**
 * Every failure of the connect, sign-in and refresh flows maps to one of
 * these codes, with text Besidka wrote. Nothing from a remote server (an
 * error description, a body, a URL) ever reaches a message, `lastError` or
 * the `?error=` of the callback redirect: it is attacker-controlled and can
 * carry secrets.
 */
export const CONNECTOR_ERRORS = {
  CONNECTOR_NOT_FOUND: {
    message: 'Connector not found',
    status: 404,
    why: 'No connector with this id belongs to the account',
    fix: 'Check the connector id',
  },
  CONNECTOR_DISCOVERY_FAILED: {
    message: 'The server did not answer as an MCP server',
    status: 502,
    why: 'The first request to the server got an unexpected answer',
    fix: 'Check the address, or try again later',
  },
  CONNECTOR_OAUTH_UNSUPPORTED: {
    message: 'This server does not offer OAuth sign-in',
    status: 409,
    why: 'The server did not publish protected-resource metadata',
    fix: 'Add a header or API key instead, if the server offers one',
  },
  CONNECTOR_OAUTH_METADATA_INVALID: {
    message: 'The sign-in server published invalid metadata',
    status: 502,
    why: 'The protected-resource or authorization-server metadata is '
      + 'missing a required field or does not match the server',
    fix: 'Try again later, or ask the service to fix its OAuth metadata',
  },
  CONNECTOR_OAUTH_PKCE_UNSUPPORTED: {
    message: 'The sign-in server does not support PKCE with S256',
    status: 409,
    why: 'Its metadata does not list S256 in code_challenge_methods_supported',
    fix: 'Besidka only signs in with PKCE S256. Use an API key if the '
      + 'server offers one',
  },
  CONNECTOR_OAUTH_NO_REGISTRATION: {
    message: 'This server needs a pre-registered client',
    status: 409,
    why: 'The sign-in server supports neither Client ID Metadata Documents '
      + 'nor dynamic client registration',
    fix: 'Besidka does not support pre-registered clients. Use an API key '
      + 'if the server offers one',
  },
  CONNECTOR_OAUTH_REGISTRATION_FAILED: {
    message: 'The sign-in server refused to register Besidka',
    status: 502,
    why: 'Dynamic client registration failed',
    fix: 'Try again later, or ask the workspace admin to allow Besidka',
  },
  CONNECTOR_OAUTH_STATE_INVALID: {
    message: 'The sign-in link expired or was already used',
    status: 400,
    why: 'The OAuth state is unknown, expired, used or belongs to another '
      + 'account',
    fix: 'Start the sign-in again from the Connectors page',
  },
  CONNECTOR_OAUTH_REDIRECT_MISMATCH: {
    message: 'The sign-in came back to a different address',
    status: 400,
    why: 'The callback address does not match the one the sign-in started '
      + 'with',
    fix: 'Start the sign-in again on the same site',
  },
  CONNECTOR_OAUTH_ISSUER_MISMATCH: {
    message: 'The sign-in answer came from the wrong server',
    status: 400,
    why: 'The iss parameter does not match the authorization server the '
      + 'sign-in started with',
    fix: 'Start the sign-in again. If it repeats, do not use this connector',
  },
  CONNECTOR_OAUTH_DENIED: {
    message: 'Sign-in was canceled',
    status: 400,
    why: 'The authorization server returned an error instead of a code',
    fix: 'Start the sign-in again and approve the access',
  },
  CONNECTOR_OAUTH_RATE_LIMITED: {
    message: 'Too many failed sign-ins',
    status: 429,
    why: 'Too many sign-in callbacks from this network failed recently',
    fix: 'Wait a few minutes and start the sign-in again',
  },
  CONNECTOR_OAUTH_TOKEN_FAILED: {
    message: 'The sign-in server did not issue a token',
    status: 502,
    why: 'The code exchange failed or returned an invalid answer',
    fix: 'Start the sign-in again',
  },
  CONNECTOR_REFRESH_FAILED: {
    message: 'The connector token could not be renewed',
    status: 502,
    why: 'The token refresh failed',
    fix: 'Try again later',
  },
  CONNECTOR_REAUTH_REQUIRED: {
    message: 'The connector needs to sign in again',
    status: 401,
    why: 'The authorization server no longer accepts the stored sign-in',
    fix: 'Connect the connector again from the Connectors page',
  },
  CONNECTOR_SCOPE_DEGRADED: {
    message: 'The service granted fewer permissions than requested',
    status: 200,
    why: 'The granted scope is narrower than the requested scope',
    fix: 'Some tools may fail. Reconnect and approve all permissions if '
      + 'you need them',
  },
  CONNECTOR_TOOLS_DRIFTED: {
    message: 'Some tools of this connector changed',
    status: 409,
    why: 'A tool is new or its definition differs from the reviewed one, '
      + 'so it is hidden from the model',
    fix: 'Review the changed tools on the Connectors page',
  },
  CONNECTOR_TOOLS_REVIEW_STALE: {
    message: 'The tools changed again',
    status: 409,
    why: 'The server\'s tool list differs from the one you reviewed',
    fix: 'Review the tools again',
  },
  CONNECTOR_TOOL_NOT_FOUND: {
    message: 'Tool not found',
    status: 404,
    why: 'No reviewed tool of this connector has this name',
    fix: 'Reload the tool list',
  },
  CONNECTOR_UNREACHABLE: {
    message: 'The connector could not be reached',
    status: 502,
    why: 'The server did not answer in time or refused the connection',
    fix: 'Try again later, or check the connector on the Connectors page',
  },
  CONNECTOR_NOT_READY: {
    message: 'The connector is not connected yet',
    status: 409,
    why: 'Only a connected connector can be turned on',
    fix: 'Connect it first',
  },
  CONNECTOR_HEADER_INVALID: {
    message: 'This header cannot be used',
    status: 400,
    why: 'The header name or value is not allowed',
    fix: 'Use a header name of letters, digits and dashes, and a value '
      + 'without line breaks of at most 4,096 bytes',
  },
  [CONNECTOR_CONSENT_ERROR_CODE]: {
    message: 'Consent is required for this connector',
    status: 403,
    why: 'Data is sent to this server only after you agree to it on the '
      + 'connect screen, for this host and sign-in server',
    fix: 'Open the connector and confirm the consent',
  },
  CONNECTOR_CONSENT_OUTDATED: {
    message: 'The consent text changed',
    status: 409,
    why: 'The consent was given for an older version of the text',
    fix: 'Reload the page and confirm the current consent',
  },
} as const satisfies Record<string, ConnectorErrorText>

export type ConnectorErrorCode = keyof typeof CONNECTOR_ERRORS

export function isConnectorErrorCode(
  value: unknown,
): value is ConnectorErrorCode {
  return typeof value === 'string' && Object.hasOwn(CONNECTOR_ERRORS, value)
}

export function createConnectorError(
  code: ConnectorErrorCode,
  data?: Record<string, string>,
) {
  const text: ConnectorErrorText = CONNECTOR_ERRORS[code]

  return createError({
    message: text.message,
    status: text.status,
    code,
    why: text.why,
    fix: text.fix,
    ...(data ? { data } : {}),
  })
}

/**
 * The fixed code of a thrown error, for logs and the callback redirect:
 * connector codes and the C-3 `safe-fetch-*` codes pass, anything else is
 * reported as `fallback`.
 */
export function connectorErrorCodeOf(
  exception: unknown,
  fallback: ConnectorErrorCode,
): string {
  const code = (exception as { code?: unknown } | null)?.code

  if (isConnectorErrorCode(code)) {
    return code
  }

  if (
    typeof code === 'string'
    && (/^safe-fetch-[a-z-]{1,24}$/.test(code)
      || code === 'CONNECTOR_ORIGIN_CHANGED')
  ) {
    return code
  }

  return fallback
}
