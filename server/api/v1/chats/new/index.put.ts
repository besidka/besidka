import * as schema from '~~/server/db/schema'

const rules = z.object({
  message: z.string().trim().min(1),
  tools: z.array(z.enum(['web_search'])),
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
      parts: [{
        type: 'text',
        text: body.data.message,
      }],
      tools: body.data.tools,
    })

  return {
    slug: chat.slug,
  }
})
