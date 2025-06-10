const rules = z.object({
  password: z.string().min(8),
  token: z.string(),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid body parameters',
      data: body.error,
    })
  }

  const { token, password: newPassword } = body.data

  return await useServerAuth().api.resetPassword({
    body: {
      token,
      newPassword,
    },
    asResponse: true,
  })
})
