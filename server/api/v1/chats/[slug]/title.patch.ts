import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
  }).safeParse)

  if (params.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request parameters',
      data: params.error,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, parseInt(session.user.id)),
      )
    },
    columns: {
      id: true,
      title: true,
    },
    with: {
      messages: {
        limit: 1,
        orderBy(messages, { asc }) {
          return asc(messages.createdAt)
        },
        columns: {
          content: true,
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

  if (chat.title) {
    return chat.title
  }

  const { provider, model } = useChatProvider()

  if (!chat.messages.length) {
    return null
  }

  const initialMessages = chat.messages[0]!.content as string
  let title = ''

  switch (provider.id) {
    case 'openai': {
      const { generateChatTitle } = await useOpenAI(
        session.user.id,
        model.id,
        [],
      )

      title = await generateChatTitle(initialMessages)
      break
    }
    case 'google': {
      const { generateChatTitle } = await useGoogle(
        session.user.id,
        model.id,
        [],
      )

      title = await generateChatTitle(initialMessages)
      break
    }
  }

  const { title: savedTitle } = await db.update(schema.chats)
    .set({
      title,
    })
    .where(eq(schema.chats.id, chat.id))
    .returning({ title: schema.chats.title })
    .get()

  return savedTitle
})
