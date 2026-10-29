import { defineEventHandler } from 'nuxt/server'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_REPOSITORY,
  MCP_SERVER_ROUTE,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
} from '~~/config/mcp-server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const SERVER_CARD_SCHEMA_URL
  = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'

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
  }, null, 2)
})
