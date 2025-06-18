import * as schema from '~~/server/db/schema'

const rules = z.object({
  message: z.string().trim().min(1),
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

  const session = await useUserSession(event)

  if (!session?.user) {
    return useUnauthorizedError()
  }

  const { provider, model } = useChatProvider(event)

  let chatTitle = ''

  switch (provider.id) {
    case 'openai': {
      const { generateChatTitle } = await useOpenAI(session.user.id, model)

      chatTitle = await generateChatTitle(body.data.message)
      break
    }
    case 'google': {
      const { generateChatTitle } = await useGoogle(session.user.id, model)

      chatTitle = await generateChatTitle(body.data.message)
      break
    }
  }

  const db = useDb()

  const user = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.id, parseInt(session.user.id))
    },
  })

  if (!user) {
    return useUnauthorizedError()
  }

  const chat = await db
    .insert(schema.chats)
    .values({
      userId: user.id,
      title: chatTitle,
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  await db
    .insert(schema.messages)
    .values({
      chatId: chat.id,
      role: 'user',
      content: body.data.message,
    })

  return {
    slug: chat.slug,
  }
})
