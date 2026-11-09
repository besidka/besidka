import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { ARTIFACT_SHARE_PATH_PREFIX } from '#shared/utils/artifacts'
import { ARTIFACT_SHARE_PUBLIC_HEADERS } from '~~/server/utils/artifacts/share-request'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const ARTIFACT_SHARE_PATH_ANY_CASE = /^\/a\//i

/**
 * True for `/A/<token>` and other paths that differ from the public
 * artifact link prefix only in case. Vue Router matches pages without
 * regard to case, but the `/a/**` route rules (no-store, no-referrer,
 * noindex, frame-ancestors) match `/a/` only, so such a path would render
 * the link page without those headers.
 */
export function isMiscasedArtifactSharePath(path: string): boolean {
  return ARTIFACT_SHARE_PATH_ANY_CASE.test(path)
    && !path.startsWith(ARTIFACT_SHARE_PATH_PREFIX)
}

export default defineEventHandler((event) => {
  if (!isMiscasedArtifactSharePath(event.path)) {
    return
  }

  applyResponseHeaders(event, ARTIFACT_SHARE_PUBLIC_HEADERS)
  setResponseStatus(event, 404)
  event.res.headers.set('Content-Type', 'text/plain; charset=utf-8')

  return 'Not found'
})
