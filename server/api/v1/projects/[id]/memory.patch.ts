import { createError } from 'evlog'
import { toggleProjectMemory } from '~~/server/utils/projects/memory'
import {
  defineEventHandler,
  getRouterParams,
  readValidatedBody,
} from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = z.object({
    id: z.string().nonempty(),
  }).safeParse(getRouterParams(event, { decode: true }))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    enabled: z.boolean(),
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
  })

  return await toggleProjectMemory(
    params.data.id,
    userId,
    body.data.enabled,
  )
})
