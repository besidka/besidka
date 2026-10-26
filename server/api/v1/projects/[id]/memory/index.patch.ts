import { createError } from 'evlog'
import { setProjectUseAccountMemory } from '~~/server/utils/projects/memory-account'
import { toggleProjectMemory } from '~~/server/utils/projects/memory-refresh'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const params = z.object({
    id: z.string().nonempty(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.union([
    z.object({
      enabled: z.boolean(),
      useAccountMemory: z.boolean().optional(),
    }),
    z.strictObject({
      useAccountMemory: z.boolean(),
    }),
  ]).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  const data = body.data

  logger.set({
    userId,
    projectId: params.data.id,
    enabled: 'enabled' in data ? data.enabled : undefined,
    attributes: {
      projectMemory: { useAccountMemory: data.useAccountMemory },
    },
  })

  if (!('enabled' in data)) {
    return await setProjectUseAccountMemory(
      params.data.id,
      userId,
      data.useAccountMemory,
      undefined,
      logger,
    )
  }

  if (data.useAccountMemory !== undefined) {
    await setProjectUseAccountMemory(
      params.data.id,
      userId,
      data.useAccountMemory,
      undefined,
      logger,
    )
  }

  return await toggleProjectMemory(
    params.data.id,
    userId,
    data.enabled,
    undefined,
    logger,
  )
})
