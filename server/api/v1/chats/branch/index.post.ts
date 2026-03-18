import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

const rules = z.object({
  chatSlug: z.string().ulid(),
  messageId: z.string().min(1),
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
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, body.data.chatSlug),
        eq(chats.userId, userId),
      )
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

  const branchIndex = chat.messages.findIndex((message) => {
    return message.publicId === body.data.messageId
      || message.id === body.data.messageId
  })

  if (branchIndex === -1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message not found in this chat.',
    })
  }

  const messagesToCopy = chat.messages.slice(0, branchIndex + 1)

  const title = chat.title
    ? `Branch: ${chat.title.replace(/Branch: /g, '')}`
    : 'Branch'

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

  const messageInserts = messagesToCopy.map((message) => {
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

  await refreshProjectActivityAt([chat.projectId], userId, db)
  await markProjectsMemoryStale([chat.projectId], userId, db)

  return {
    slug: newChat.slug,
  }
})
