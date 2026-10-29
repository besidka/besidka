import { defineEventHandler } from 'nuxt/server'
import { buildAuthMd } from '~~/server/utils/agent-discovery/auth-md'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler((event) => {
  applyResponseHeaders(event, {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return buildAuthMd(getSiteOrigin(event))
})
