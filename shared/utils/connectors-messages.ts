import { CONNECTOR_CONSENT_ERROR_CODE } from '#shared/utils/connectors-policy'

export const CONNECTOR_CALLBACK_FALLBACK_MESSAGE
  = 'Sign-in did not finish. Try connecting again.'

/**
 * The user-facing message of every fixed connector code, for codes that
 * reach the browser outside an error response: the OAuth callback's
 * `?error=<code>` and the `unavailable` tool list. The query value is
 * attacker-controlled, so it is only ever a lookup key, never shown. A spec
 * keeps these in step with `CONNECTOR_ERRORS` on the server.
 */
export const CONNECTOR_CODE_MESSAGES: Readonly<Record<string, string>> = {
  CONNECTOR_NOT_FOUND: 'Connector not found',
  CONNECTOR_OWN_SERVER: 'This is Besidka\'s own MCP server',
  CONNECTOR_DISCOVERY_FAILED: 'The server did not answer as an MCP server',
  CONNECTOR_OAUTH_UNSUPPORTED: 'This server does not offer OAuth sign-in',
  CONNECTOR_OAUTH_METADATA_INVALID:
    'The sign-in server published invalid metadata',
  CONNECTOR_OAUTH_PKCE_UNSUPPORTED:
    'The sign-in server does not support PKCE with S256',
  CONNECTOR_OAUTH_NO_REGISTRATION: 'This server needs a pre-registered client',
  CONNECTOR_OAUTH_REGISTRATION_FAILED:
    'The sign-in server refused to register Besidka',
  CONNECTOR_OAUTH_STATE_INVALID: 'The sign-in link expired or was already used',
  CONNECTOR_OAUTH_REDIRECT_MISMATCH:
    'The sign-in came back to a different address',
  CONNECTOR_OAUTH_ISSUER_MISMATCH:
    'The sign-in answer came from the wrong server',
  CONNECTOR_OAUTH_DENIED: 'Sign-in was canceled',
  CONNECTOR_OAUTH_RATE_LIMITED: 'Too many failed sign-ins',
  CONNECTOR_OAUTH_TOKEN_FAILED: 'The sign-in server did not issue a token',
  CONNECTOR_REFRESH_FAILED: 'The connector token could not be renewed',
  CONNECTOR_REAUTH_REQUIRED: 'The connector needs to sign in again',
  CONNECTOR_SCOPE_DEGRADED:
    'The service granted fewer permissions than requested',
  CONNECTOR_TOOLS_DRIFTED: 'Some tools of this connector changed',
  CONNECTOR_TOOLS_REVIEW_REQUIRED:
    'Review the tools before turning this connector on',
  CONNECTOR_TOOLS_REVIEW_STALE: 'The tools changed again',
  CONNECTOR_TOOL_ALWAYS_ALLOW_REFUSED:
    'This tool cannot be set to Always allow',
  CONNECTOR_TOOL_NOT_FOUND: 'Tool not found',
  CONNECTOR_UNREACHABLE: 'The connector could not be reached',
  CONNECTOR_NOT_READY: 'The connector is not connected yet',
  CONNECTOR_CREDENTIALS_REJECTED: 'The server did not accept this key',
  CONNECTOR_AUTH_REQUIRED: 'This server needs a sign-in or a key',
  CONNECTOR_LIMIT_REACHED: 'Connector limit reached',
  CONNECTOR_HEADER_INVALID: 'This header cannot be used',
  [CONNECTOR_CONSENT_ERROR_CODE]: 'Consent is required for this connector',
  CONNECTOR_CONSENT_OUTDATED: 'The consent text changed',
  CONNECTOR_ORIGIN_CHANGED: 'The server sent the sign-in to another address',
}

export function connectorCodeMessage(code: unknown): string {
  if (typeof code !== 'string' || !Object.hasOwn(CONNECTOR_CODE_MESSAGES, code)) {
    return CONNECTOR_CALLBACK_FALLBACK_MESSAGE
  }

  return CONNECTOR_CODE_MESSAGES[code]!
}
