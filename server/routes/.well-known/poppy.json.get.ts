import { defineEventHandler } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler((event) => {
  applyResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return JSON.stringify({
    protocol_version: '0.1',
    organization: {
      name: 'Besidka',
      domain: getSiteHostname(event),
    },
    web: {},
  }, null, 2)
})
