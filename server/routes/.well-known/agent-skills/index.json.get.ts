import { defineEventHandler } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler(async (event) => {
  const index = await buildAgentSkillsIndex(getSiteOrigin(event))

  applyResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return JSON.stringify(index, null, 2)
})
