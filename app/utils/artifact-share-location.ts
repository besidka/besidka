import { ARTIFACT_SHARE_PATH } from '#shared/utils/artifacts'

export interface AnalyticsLocation {
  path: string
  query?: Record<string, unknown>
}

function readNextQuery(query: AnalyticsLocation['query']): string {
  const value = query?.next

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function isArtifactSharePath(value: string): boolean {
  const pathname = value.split(/[?#]/)[0]?.toLowerCase() ?? ''

  return pathname === ARTIFACT_SHARE_PATH
    || pathname.startsWith(`${ARTIFACT_SHARE_PATH}/`)
}

/**
 * The public artifact link page (`/a`, which holds the share token in the
 * fragment) and pages that return to it in `next` (sign-in from a link)
 * must never be seen by analytics. The path is matched in any case,
 * because the router opens `/A` as the same page, and `/a/...` is matched
 * too so an old path-form link never reaches the beacon either.
 */
export function isArtifactShareLocation(location: AnalyticsLocation): boolean {
  return isArtifactSharePath(location.path)
    || isArtifactSharePath(readNextQuery(location.query))
}
