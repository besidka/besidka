import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import type { MemoryEntryResponse } from '#shared/types/memory-api.d'
import { memoryEntryPatchSchema } from '#shared/utils/memory-schemas'
import { updateMemoryEntry } from '~~/server/utils/memory/entries'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

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

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await enforceMemoryRateLimit(
    'write',
    parseInt(session.user.id),
    event,
  )

  const body = await readValidatedBody(event, memoryEntryPatchSchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  await requireLegalConsent(userId)

  logger.set({
    userId,
    attributes: {
      memoryEntries: {
        action: 'update',
        entryId: params.data.id,
        fields: Object.keys(body.data),
      },
    },
  })

  const { entry } = await updateMemoryEntry(
    { db: useDb(), userId, logger },
    {
      id: params.data.id,
      patch: body.data,
      origin: 'user',
      complianceOrigin: 'memory-api',
    },
  )

  const response: MemoryEntryResponse = { entry }

  return response
})
