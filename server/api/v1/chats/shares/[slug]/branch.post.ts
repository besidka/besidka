import type { BatchItem } from 'drizzle-orm/batch'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(
    event,
    paramsRules.safeParse,
  )

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

  const userId = parseInt(session.user.id)

  logger.set({ userId, shareSlug: params.data.slug })

  const share = await resolveActiveShareBySlug(
    params.data.slug,
    event,
  )

  if (!share) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  if (!share.allowBranch) {
    throw createError({
      message: 'Branching is disabled for this shared chat',
      status: 403,
      why: 'The share owner has turned off branching for this link',
    })
  }

  const db = useDb()

  const sourceChat = await db.query.chats.findFirst({
    where: { id: share.chatId },
    columns: {
      id: true,
      title: true,
    },
    with: {
      messages: {
        columns: {
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
        },
      },
    },
  })

  if (!sourceChat) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const persistedMessages = sourceChat.messages.filter((message) => {
    return isPersistedMessageRole(message.role)
  })

  const title = sourceChat.title
    ? `Branch: ${sourceChat.title.replace(/Branch: /g, '')}`
    : 'Branch'

  const newChat = await db
    .insert(schema.chats)
    .values({
      userId,
      title,
      branchedFromShareSlug: params.data.slug,
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  if (persistedMessages.length > 0) {
    const messageInserts = persistedMessages.map((message) => {
      return db
        .insert(schema.messages)
        .values({
          chatId: newChat.id,
          role: message.role,
          parts: message.parts,
          tools: message.tools,
          reasoning: message.reasoning,
        })
    }) as unknown as [BatchItem<'sqlite'>]

    await db.batch(messageInserts)
  }

  return { slug: newChat.slug }
})
