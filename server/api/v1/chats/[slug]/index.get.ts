const unauthorizedError = `You don't have access to this resource. Try to sign out and sign in again.`

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

  const session = await useServerAuth().api.getSession({
    // @ts-ignore
    headers: getHeaders(event),
  })

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: unauthorizedError,
    })
  }

  const { model } = parseCookies(event)

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Please select a model to continue.',
    })
  }

  const { providers } = useRuntimeConfig()
  const provider = Object.values(providers).find((p) => {
    return p.models.some((m: any) => m.id === model)
  })

  if (!provider) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Current model is not supported by any provider. Please select a different model.',
    })
  }

  const chat = await useDb().query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, parseInt(session.user.id)),
      )
    },
    columns: {
      id: true,
      slug: true,
      title: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          role: true,
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

  return chat
})
