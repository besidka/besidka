import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { setBesidkaChatEnabled } from '~~/server/utils/besidka-tools/chat-settings'
import { requireBesidkaChatAccess } from '~~/server/utils/besidka-tools/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BODY_MAX_BYTES = 256

const bodySchema = z.strictObject({ enabled: z.boolean() })

/**
 * Switches Besidka tools on or off for this chat. The chat's "Allow in this
 * chat" grants stay as they are.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireBesidkaChatAccess(event, {
    write: true,
  })

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Send whether Besidka tools are on',
    })
  }

  const settings = await setBesidkaChatEnabled(
    useDb(),
    userId,
    chatPublicId,
    body.data.enabled,
  )

  useRequestLogger(event).set({
    attributes: {
      besidkaTools: { action: 'chat-toggle', enabled: settings.enabled },
    },
  })

  return { enabled: settings.enabled }
})
