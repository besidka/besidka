import { defineEventHandler } from 'nuxt/server'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_REPOSITORY,
  MCP_SERVER_ROUTE,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
} from '~~/config/mcp-server'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const SERVER_CARD_SCHEMA_URL
  = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'

const AUTHORIZATION_META_KEY = 'com.besidka/authorization'

const PROTECTED_RESOURCE_METADATA_PATH
  = `/.well-known/oauth-protected-resource${MCP_SERVER_ROUTE}`

const AUTHORIZATION_SERVER_METADATA_PATH
  = '/.well-known/oauth-authorization-server'

export default defineEventHandler((event) => {
  const origin = getSiteOrigin(event)

  applyResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return JSON.stringify({
    $schema: SERVER_CARD_SCHEMA_URL,
    name: MCP_SERVER_NAME,
    title: MCP_SERVER_TITLE,
    version: MCP_SERVER_VERSION,
    description: MCP_SERVER_DESCRIPTION,
    websiteUrl: origin,
    repository: MCP_SERVER_REPOSITORY,
    remotes: [
      {
        type: 'streamable-http',
        url: `${origin}${MCP_SERVER_ROUTE}`,
      },
    ],
    _meta: {
      [AUTHORIZATION_META_KEY]: {
        required: false,
        description: 'Public read-only tools need no token. Per-user tools need an OAuth 2.1 access token for a signed-in Besidka user. Without one the server answers 401 with a WWW-Authenticate header that points at the protected resource metadata.',
        type: 'oauth2',
        flow: 'authorization_code',
        pkce: 'S256',
        protectedResourceMetadata:
          `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`,
        authorizationServerMetadata:
          `${origin}${AUTHORIZATION_SERVER_METADATA_PATH}`,
        scopesSupported: MCP_OAUTH_SCOPES,
      },
    },
  }, null, 2)
})
