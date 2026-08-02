import { createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = await getValidatedRouterParams(event, z.object({
    id: z.coerce.number().int().positive(),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  const row = await useDb().query.sessions.findFirst({
    where: {
      id: params.data.id,
      userId,
    },
    columns: {
      token: true,
    },
  })

  if (!row) {
    throw createError({
      message: 'Session not found',
      status: 404,
    })
  }

  await useServerAuth().api.revokeSession({
    body: {
      token: row.token,
    },
    // @ts-ignore
    headers: getHeaders(event),
  })

  return setResponseStatus(event, 204, 'Session revoked successfully')
})
