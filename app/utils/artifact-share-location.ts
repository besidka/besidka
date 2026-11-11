import { ARTIFACT_SHARE_PATH_PREFIX } from '#shared/utils/artifacts'

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

/**
 * Public artifact links (`/a/<token>`) and pages that carry one in `next`
 * (sign-in from a link) hold the share token in their URL, so analytics
 * must never see them. The prefix is matched in any case, because the
 * router opens `/A/<token>` as the same page.
 */
export function isArtifactShareLocation(location: AnalyticsLocation): boolean {
  return location.path.toLowerCase().startsWith(ARTIFACT_SHARE_PATH_PREFIX)
    || readNextQuery(location.query)
      .toLowerCase()
      .startsWith(ARTIFACT_SHARE_PATH_PREFIX)
}
