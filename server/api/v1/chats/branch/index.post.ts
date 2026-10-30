import { createError } from 'evlog'
import { branchChat } from '~~/server/utils/chats/branch'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const rules = z.object({
  chatSlug: z.string().ulid(),
  messageId: z.string().min(1).max(64).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session?.user) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  await requireLegalConsent(userId)

  const db = useDb()

  const newChat = await branchChat(
    db,
    userId,
    body.data.chatSlug,
    body.data.messageId,
    logger,
  )

  return {
    slug: newChat.slug,
  }
})
