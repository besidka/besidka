import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { assertSameOriginAdminRequest }
  from '~~/server/utils/features/admin-request'
import { useFeatureContext } from '~~/server/utils/features/context'
import {
  hasObjectedToExperiments,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { setExperimentsObjection } from '~~/server/utils/features/opt-ins'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const objectionBodySchema = z.object({
  objected: z.boolean(),
})

export default defineEventHandler(async (event) => {
  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

  const featureContext = await useFeatureContext(event)
  const userId = featureContext.userId

  if (userId === null) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, objectionBodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const db = useDb()

  await setExperimentsObjection(
    { db, userId, logger: useRequestLogger(event) },
    body.data.objected,
  )

  const userState = await loadUserFeatureState(db, userId)

  return { objectedToExperiments: hasObjectedToExperiments(userState) }
})
