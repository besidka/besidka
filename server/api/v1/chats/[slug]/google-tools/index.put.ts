import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { GOOGLE_SERVICES } from '#shared/utils/google-tool-catalog'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { setGoogleServiceEnabled } from '~~/server/utils/besidka-tools/chat-settings'
import {
  requireGoogleChatToolsAccess,
  toGoogleChatServiceStates,
} from '~~/server/utils/google/chat-tools-route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BODY_MAX_BYTES = 256

const bodySchema = z.strictObject({
  service: z.enum(GOOGLE_SERVICES),
  enabled: z.boolean(),
})

/**
 * Switches one Google service on or off for this chat and answers with the
 * three switches. The chat's other services, its Besidka switch and its
 * grants stay as they are. A switch only removes tools: the data guard
 * depends on the chat's Google-data flag alone.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireGoogleChatToolsAccess(event, {
    write: true,
  })

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Send a Google service and whether it is on',
    })
  }

  const servicesOff = await setGoogleServiceEnabled(
    useDb(),
    userId,
    chatPublicId,
    body.data.service,
    body.data.enabled,
  )

  useRequestLogger(event).set({
    attributes: {
      google: {
        chatService: {
          service: body.data.service,
          enabled: body.data.enabled,
        },
      },
    },
  })

  return toGoogleChatServiceStates(servicesOff)
})
