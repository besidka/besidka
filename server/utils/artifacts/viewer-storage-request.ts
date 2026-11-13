import type { RequestEvent } from 'nuxt/server'
import {
  ARTIFACT_SHARE_HEADER,
  ARTIFACT_STORAGE_KEY_PATTERN,
} from '#shared/utils/artifacts'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'
import { z } from 'zod'
import type { ArtifactViewerAccess } from '~~/server/utils/artifacts/access'
import { resolveArtifactViewerAccess } from '~~/server/utils/artifacts/access'
import type {
  ArtifactStorageScope,
} from '~~/server/utils/artifacts/viewer-storage'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Refuses a request body larger than `maxBytes` by its `Content-Length`
 * before it is read, so a direct API call cannot make the Worker parse
 * megabytes that validation would reject anyway. A body without a
 * `Content-Length` (chunked) is refused with 411, because its size cannot be
 * checked up front, and a header that is not a number with 400. Call it only
 * on routes that read a request body.
 */
export function assertRequestBodyLength(
  event: RequestEvent,
  maxBytes: number,
): void {
  const header = getRequestHeader(event, 'content-length')

  if (header === undefined || header === null || header.trim() === '') {
    throw createError({
      message: 'Content-Length required',
      status: 411,
      why: 'The request did not declare the size of its body.',
      fix: 'Send the body with a Content-Length header.',
    })
  }

  const length = Number(header)

  if (!Number.isFinite(length) || length < 0) {
    throw createError({
      message: 'Invalid Content-Length',
      status: 400,
      why: 'The Content-Length header is not a valid size.',
    })
  }

  if (length <= maxBytes) {
    return
  }

  throw createError({
    message: 'Request too large',
    status: 413,
    why: `The request body is ${length} bytes; at most ${maxBytes} are `
      + 'accepted.',
  })
}

export type ArtifactStorageOperation = 'list' | 'set' | 'delete' | 'reset'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  key: z.string().regex(ARTIFACT_STORAGE_KEY_PATTERN).optional(),
})

export interface ArtifactStorageRequest {
  access: ArtifactViewerAccess
  scope: ArtifactStorageScope
  key: string | null
  logger: ReturnType<typeof useRequestLogger>
}

/**
 * The common preamble of the saved-progress routes, which each check the
 * viewer's own `artifacts.storage` flag first (it includes the global
 * `artifacts` rule): a session, current legal consent (A-12), valid params
 * and viewer access that allows storage. Every route acts only on the
 * caller's own rows, so no route can return another viewer's values, the
 * owner's included.
 */
export async function resolveArtifactStorageRequest(
  event: RequestEvent,
  operation: ArtifactStorageOperation,
): Promise<ArtifactStorageRequest> {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid saved progress key',
      status: 400,
      why: params.error.message,
      fix: 'Use 1 to 128 letters, digits, dots, underscores, colons or '
        + 'hyphens.',
    })
  }

  const viewerUserId = parseInt(session.user.id)
  const db = useDb()

  logger.set({
    userId: viewerUserId,
    attributes: {
      artifacts: { operation: `storage-${operation}`, artifactId: params.data.id },
    },
  })

  await requireLegalConsent(viewerUserId, db)

  const access = await resolveArtifactViewerAccess({
    db,
    viewerUserId,
    artifactId: params.data.id,
    shareToken: getRequestHeader(event, ARTIFACT_SHARE_HEADER) ?? null,
  })

  if (!access.storageAllowed) {
    throw createError({
      message: 'Saving progress is off for this artifact',
      status: 403,
      why: 'The share link does not allow saved progress',
    })
  }

  logger.set({ attributes: { artifacts: { viewerMode: access.mode } } })

  return {
    access,
    scope: {
      db,
      artifactInternalId: access.artifactInternalId,
      viewerUserId,
    },
    key: params.data.key ?? null,
    logger,
  }
}
