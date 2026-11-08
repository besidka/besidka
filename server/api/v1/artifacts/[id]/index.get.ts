import { createError } from 'evlog'
import { z } from 'zod'
import { defineEventHandler } from 'nuxt/server'
import { getArtifactDetail } from '~~/server/utils/artifacts/queries'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'artifacts')

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact id',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  logger.set({
    userId,
    attributes: {
      artifacts: { operation: 'detail', artifactId: params.data.id },
    },
  })

  return await getArtifactDetail({
    db: useDb(),
    userId,
    artifactId: params.data.id,
  })
})
