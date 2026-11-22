import type { RequestEvent } from 'nuxt/server'
import type { ResolvedArtifactShare } from '~~/server/utils/artifacts/shares'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'
import { ARTIFACT_SHARE_HEADER } from '#shared/utils/artifacts'
import {
  encodeArtifactShareId,
  resolveActiveArtifactShare,
} from '~~/server/utils/artifacts/shares'
import { ARTIFACT_ERROR_CODES } from '~~/server/utils/artifacts/store'
import { requireGlobalFeature } from '~~/server/utils/features/global'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const ARTIFACT_SHARE_PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export type ActiveArtifactShare = Extract<
  ResolvedArtifactShare,
  { status: 'active' }
>

export function createArtifactShareNotFoundError() {
  return createError({
    message: 'Link not found',
    status: 404,
    code: ARTIFACT_ERROR_CODES.notFound,
    why: 'This link does not exist, was revoked or has expired',
  })
}

export function createArtifactShareTakenDownError() {
  return createError({
    message: 'This artifact was removed after a report',
    status: 410,
    code: ARTIFACT_ERROR_CODES.takenDown,
    why: 'The artifact or this link was disabled after a report',
    data: { takenDown: true },
  })
}

/**
 * The gate of every public share route: the no-store, no-referrer and
 * noindex headers first (so 404 and 410 carry them too), the global
 * `artifacts` rule (kill switch, never the viewer's own flag), then the
 * token from the `x-besidka-artifact-share` header. 404 for a missing,
 * unknown, revoked or expired link, 410 `{ takenDown: true }` after a
 * takedown. Logs the share and artifact ids, never the token.
 */
export async function requireActiveArtifactShare(
  event: RequestEvent,
): Promise<ActiveArtifactShare> {
  applyResponseHeaders(event, ARTIFACT_SHARE_PUBLIC_HEADERS)

  await requireGlobalFeature(event, 'artifacts')

  const logger = useRequestLogger(event)
  const resolved = await resolveActiveArtifactShare({
    db: useDb(),
    token: getRequestHeader(event, ARTIFACT_SHARE_HEADER) ?? null,
  })

  logger.set({
    attributes: {
      artifacts: {
        shareId: resolved ? encodeArtifactShareId(resolved.share.id) : null,
        shareStatus: resolved?.status ?? 'not-found',
      },
    },
  })

  if (!resolved) {
    throw createArtifactShareNotFoundError()
  }

  if (resolved.status === 'taken-down') {
    throw createArtifactShareTakenDownError()
  }

  return resolved
}
