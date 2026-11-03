import { defineEventHandler } from 'nuxt/server'
import { MCP_REGISTRY_PUBLIC_KEY } from '~~/config/mcp-server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler((event) => {
  applyResponseHeaders(event, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return `v=MCPv1; k=ed25519; p=${MCP_REGISTRY_PUBLIC_KEY}`
})
