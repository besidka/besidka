import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  shareId: z.string().min(1).max(80).optional(),
})

export interface ArtifactShareOwnerRequest {
  userId: number
  artifactId: string
  shareId: string | null
  logger: ReturnType<typeof useRequestLogger>
}

/**
 * Session and route params of the owner share routes, which each check
 * `artifacts.share` first. Ownership of the artifact is checked by the share
 * helpers, which answer 404 for a foreign or unknown id.
 */
export async function resolveArtifactShareOwnerRequest(
  event: RequestEvent,
  operation: string,
): Promise<ArtifactShareOwnerRequest> {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  event.res.headers.set('Cache-Control', 'private, no-store')
  logger.set({
    userId,
    attributes: {
      artifacts: {
        operation,
        artifactId: params.data.id,
        shareId: params.data.shareId ?? null,
      },
    },
  })

  return {
    userId,
    artifactId: params.data.id,
    shareId: params.data.shareId ?? null,
    logger,
  }
}
