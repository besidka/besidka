const rules = z.object({
  email: z.email(),
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

  return await useServerAuth().api.forgetPassword({
    body: {
      email: body.data.email,
      redirectTo: '/new-password',
    },
    asResponse: true,
  })
})
