import {
  CONNECTOR_CLIENT_METADATA_PATH,
  CONNECTOR_OAUTH_CALLBACK_PATH,
} from '#shared/utils/connectors-policy'

const CLIENT_NAME = 'Besidka'
const LOGO_PATH = '/web-app-manifest-512x512.png'
const PRIVACY_POLICY_PATH = '/privacy-policy'
const TERMS_OF_USE_PATH = '/terms-of-use'

export interface ConnectorClientMetadataDocument {
  client_id: string
  client_name: string
  client_uri: string
  logo_uri: string
  policy_uri: string
  tos_uri: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: 'none'
}

export function connectorClientId(origin: string): string {
  return `${origin}${CONNECTOR_CLIENT_METADATA_PATH}`
}

export function connectorRedirectUri(origin: string): string {
  return `${origin}${CONNECTOR_OAUTH_CALLBACK_PATH}`
}

/**
 * Besidka's Client ID Metadata Document for one origin
 * (docs/connectors.md section 5.3). The origin comes from
 * `resolveRequestPublicOrigin`: the configured base URL, or an allow-listed
 * preview host, never an arbitrary `Host` header. No contacts, no secrets.
 */
export function buildConnectorClientMetadata(
  origin: string,
): ConnectorClientMetadataDocument {
  return {
    client_id: connectorClientId(origin),
    client_name: CLIENT_NAME,
    client_uri: `${origin}/`,
    logo_uri: `${origin}${LOGO_PATH}`,
    policy_uri: `${origin}${PRIVACY_POLICY_PATH}`,
    tos_uri: `${origin}${TERMS_OF_USE_PATH}`,
    redirect_uris: [connectorRedirectUri(origin)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}
