import { defineEventHandler } from 'nuxt/server'
import { createError } from 'evlog'
import { deleteAllConnectorImages } from '~~/server/utils/files/connector-images'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const result = await deleteAllConnectorImages(
    useDb(),
    parseInt(session.user.id),
    logger,
  )

  logger.set({ attributes: { connectorImagesDelete: result } })

  if (result.failed > 0 && result.deleted === 0) {
    throw createError({
      message: 'Failed to delete connector images. Please try again.',
      status: 409,
      why: 'The storage delete failed.',
    })
  }

  return result
})
