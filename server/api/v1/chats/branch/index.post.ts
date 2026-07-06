import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import * as schema from '~~/server/db/schema'
import {
  buildBranchTitle,
  insertBranchedMessages,
} from '~~/server/utils/chats/branch'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

const rules = z.object({
  chatSlug: z.string().ulid(),
  messageId: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession()

  if (!session?.user) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const db = useDb()

  const chat = await db.query.chats.findFirst({
    where: {
      slug: body.data.chatSlug,
      userId,
    },
    columns: {
      id: true,
      title: true,
      projectId: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          publicId: true,
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
          usage: true,
          createdAt: true,
        },
      },
    },
  })

  if (!chat) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat not found.',
    })
  }

  const persistedMessages = chat.messages.filter((message) => {
    return isPersistedMessageRole(message.role)
  })

  let messagesToCopy = persistedMessages

  if (body.data.messageId) {
    const branchIndex = persistedMessages.findIndex((message) => {
      return message.publicId === body.data.messageId
        || message.id === body.data.messageId
    })

    if (branchIndex === -1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Message not found in this chat.',
      })
    }

    messagesToCopy = persistedMessages.slice(0, branchIndex + 1)
  }

  const title = buildBranchTitle(chat.title)

  const newChat = await db
    .insert(schema.chats)
    .values({
      userId,
      title,
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  await insertBranchedMessages(
    db,
    newChat.id,
    messagesToCopy.map((message) => {
      return {
        role: message.role,
        parts: message.parts,
        tools: message.tools,
        reasoning: message.reasoning,
        usage: message.usage,
        createdAt: message.createdAt,
      }
    }),
  )

  await refreshProjectActivityAt([chat.projectId], userId, db)
  await markProjectsMemoryStale([chat.projectId], userId, db)

  return {
    slug: newChat.slug,
  }
})
