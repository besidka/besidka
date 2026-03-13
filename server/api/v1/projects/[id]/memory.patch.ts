import { useLogger, createError } from 'evlog'
import { toggleProjectMemory } from '~~/server/utils/projects/memory'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const params = await getValidatedRouterParams(event, z.object({
    id: z.string().nonempty(),
  }).safeParse)

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
