import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/

/**
 * IndexNow key file. The post-deploy CI step submits URLs with
 * `keyLocation` pointing here, and IndexNow fetches this file to prove the
 * submitter controls the host. The key is public by design; it lives in
 * runtime config (NUXT_INDEXNOW_KEY) so it is not committed before the owner
 * generates one. Unset or malformed → 404. See docs/seo.md.
 */
export default defineEventHandler((event) => {
  const { indexnowKey } = useRuntimeConfig()

  if (!INDEXNOW_KEY_PATTERN.test(indexnowKey)) {
    setResponseStatus(event, 404)

    return null
  }

  applyResponseHeaders(event, {
    'content-type': 'text/plain; charset=utf-8',
    'x-robots-tag': 'noindex',
  })

  return indexnowKey
})
