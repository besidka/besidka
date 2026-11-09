import type { RequestEvent } from 'nuxt/server'
import { ARTIFACT_STORAGE_KEY_PATTERN } from '#shared/utils/artifacts'
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

export const ARTIFACT_SHARE_HEADER = 'x-besidka-artifact-share'

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
