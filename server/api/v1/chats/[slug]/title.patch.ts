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

  const body = await readValidatedBody(event, z.object({
    model: z.string().nonempty(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
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
        limit: 1,
        where(messages, { eq }) {
          return eq(messages.role, 'user')
        },
        orderBy(messages, { asc }) {
          return asc(messages.createdAt)
        },
        columns: {
          parts: true,
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

  const { provider, model } = useChatProvider(body.data.model)

  const initialMessage = chat.messages[0]

  if (!initialMessage) {
    return null
  }

  // @ts-expect-error
  const initialMessages = initialMessage.parts?.[0]?.text as string
  let title = ''

  switch (provider.id) {
    case 'openai': {
      const { generateChatTitle } = await useOpenAI(
        session.user.id,
        model.id,
        [],
        'off',
      )

      title = await generateChatTitle(initialMessages)
      break
    }
    case 'google': {
      const { generateChatTitle } = await useGoogle(
        session.user.id,
        model.id,
        [],
        'off',
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
