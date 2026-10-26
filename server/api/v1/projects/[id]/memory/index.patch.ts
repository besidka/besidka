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

  const body = await readValidatedBody(event, z.object({
    enabled: z.boolean().optional(),
    useAccountMemory: z.boolean().optional(),
  }).refine((value) => {
    return value.enabled !== undefined
      || value.useAccountMemory !== undefined
  }, {
    message: 'Provide enabled or useAccountMemory',
  }).safeParse)

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

  logger.set({
    userId,
    projectId: params.data.id,
    enabled: body.data.enabled,
    useAccountMemory: body.data.useAccountMemory,
  })

  const { enabled, useAccountMemory } = body.data

  if (useAccountMemory !== undefined) {
    const card = await setProjectUseAccountMemory(
      params.data.id,
      userId,
      useAccountMemory,
      undefined,
      logger,
    )

    if (enabled === undefined) {
      return card
    }
  }

  if (enabled === undefined) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: 'Provide enabled or useAccountMemory',
    })
  }

  return await toggleProjectMemory(
    params.data.id,
    userId,
    enabled,
    undefined,
    logger,
  )
})
