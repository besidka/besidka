import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler((event) => {
  const { openaiAppsChallenge } = useRuntimeConfig()
  const token = String(openaiAppsChallenge || '').trim()

  if (!token) {
    setResponseStatus(event, 404)

    return null
  }

  applyResponseHeaders(event, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'x-robots-tag': 'noindex',
  })

  return token
})
