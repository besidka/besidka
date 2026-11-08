import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import {
  assertSameOriginAdminRequest,
  readAdminFlagParam,
} from '~~/server/utils/features/admin-request'
import {
  evaluateFeatureForEvent,
  useFeatureContext,
} from '~~/server/utils/features/context'
import {
  isActiveOptIn,
  isFeatureActive,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { createFeatureUnavailableError } from '~~/server/utils/features/guards'
import { setFeatureOptIn } from '~~/server/utils/features/opt-ins'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const optInBodySchema = z.object({
  optedIn: z.boolean(),
})

export default defineEventHandler(async (event) => {
  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

  const featureContext = await useFeatureContext(event)
  const userId = featureContext.userId

  if (userId === null) {
    return useUnauthorizedError()
  }

  const flag = readAdminFlagParam(event)
  const body = await readValidatedBody(event, optInBodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const definition = getFeatureDefinition(flag)
  const resolution = await evaluateFeatureForEvent(event, flag, {
    recordExposure: false,
  })

  if (!definition?.exposeToClient || !resolution.value) {
    throw createFeatureUnavailableError()
  }

  if (definition.optIn !== 'required') {
    throw createError({
      message: 'This feature does not need an opt-in',
      status: 400,
      why: 'opt_in_not_applicable',
    })
  }

  const db = useDb()

  await setFeatureOptIn(
    { db, userId, logger: useRequestLogger(event) },
    flag,
    body.data.optedIn,
  )

  const userState = await loadUserFeatureState(db, userId)

  return {
    flag,
    optedIn: isActiveOptIn(userState?.optIns[flag]),
    active: isFeatureActive(flag, resolution, userState),
  }
})
