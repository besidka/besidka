import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { ARTIFACT_SHARE_PATH } from '#shared/utils/artifacts'
import { ARTIFACT_SHARE_PUBLIC_HEADERS } from '~~/server/utils/artifacts/share-request'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const ARTIFACT_SHARE_PATH_ANY_FORM = /^\/a(?:\/.*)?$/i
const ARTIFACT_SHARE_NOT_FOUND_HEADERS = {
  ...ARTIFACT_SHARE_PUBLIC_HEADERS,
  'Content-Security-Policy': 'frame-ancestors \'none\'',
}

/**
 * True for every path under the public artifact link page except the page
 * itself: `/a/<anything>` (the old token-in-path form, and `/a/`) and any
 * mis-cased `/A` or `/A/...`. Vue Router matches pages without regard to
 * case, but the `/a` route rules (no-store, no-referrer, noindex,
 * frame-ancestors) match the exact path. The link keeps its token in the
 * fragment (`/a#<token>`), so no valid link needs another form.
 */
export function isNonCanonicalArtifactSharePath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? ''

  return ARTIFACT_SHARE_PATH_ANY_FORM.test(pathname)
    && pathname !== ARTIFACT_SHARE_PATH
}

export default defineEventHandler((event) => {
  if (!isNonCanonicalArtifactSharePath(event.path)) {
    return
  }

  applyResponseHeaders(event, ARTIFACT_SHARE_NOT_FOUND_HEADERS)
  setResponseStatus(event, 404)
  event.res.headers.set('Content-Type', 'text/plain; charset=utf-8')

  return 'Not found'
})
