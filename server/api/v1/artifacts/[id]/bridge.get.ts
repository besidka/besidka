import type { ArtifactBridgeInfo } from '#shared/utils/artifacts'
import {
  ARTIFACT_BRIDGE_DAILY_LIMIT,
  ARTIFACT_BRIDGE_HOURLY_LIMIT,
  ARTIFACT_SHARE_HEADER,
} from '#shared/utils/artifacts'
import { createError } from 'evlog'
import { defineEventHandler, getRequestHeader } from 'nuxt/server'
import { z } from 'zod'
import {
  readAvailableKeys,
  resolveCheapestDirectModel,
} from '~~/server/utils/ai/resolve-cheapest-model'
import { resolveArtifactViewerAccess } from '~~/server/utils/artifacts/access'
import {
  listArtifactBridgeModels,
  readArtifactBridgeRemaining,
} from '~~/server/utils/artifacts/bridge'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  assertLegalConsent,
  readLegalConsent,
} from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

export default defineEventHandler(async (
  event,
): Promise<ArtifactBridgeInfo> => {
  await requireFeature(event, 'artifacts.llm-bridge')

  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact',
      status: 400,
      why: params.error.message,
    })
  }

  const viewerUserId = parseInt(session.user.id)
  const db = useDb()

  logger.set({
    userId: viewerUserId,
    attributes: {
      artifactBridge: { operation: 'models', artifactId: params.data.id },
    },
  })

  const access = await resolveArtifactViewerAccess({
    db,
    viewerUserId,
    artifactId: params.data.id,
    shareToken: getRequestHeader(event, ARTIFACT_SHARE_HEADER) ?? null,
  })

  if (!access.bridgeAllowed) {
    throw createError({
      message: 'AI requests are off for this artifact',
      status: 403,
      why: 'The share link does not allow AI requests',
    })
  }

  const legalConsent = await readLegalConsent(viewerUserId, db)

  assertLegalConsent(legalConsent)
  const availableKeys = await readAvailableKeys(
    viewerUserId,
    db,
    legalConsent,
  )
  const models = listArtifactBridgeModels(availableKeys)
  const remaining = await readArtifactBridgeRemaining({
    viewerUserId,
    artifactInternalId: access.artifactInternalId,
  })

  event.res.headers.set('Cache-Control', 'private, no-store')

  return {
    models,
    defaultModelId: resolveCheapestDirectModel(availableKeys)?.modelId
      ?? models[0]?.id
      ?? null,
    remaining,
    limits: {
      hour: ARTIFACT_BRIDGE_HOURLY_LIMIT.max,
      day: ARTIFACT_BRIDGE_DAILY_LIMIT.max,
    },
  }
})
