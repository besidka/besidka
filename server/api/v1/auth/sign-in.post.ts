const rules = z.object({
  email: z.email(),
  password: z.string().min(8),
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

  const response = await useServerAuth().api.signInEmail({
    body: body.data,
    asResponse: true,
  })

  if (!response.ok) {
    switch (response.status) {
      case 403:
        throw createError({
          statusCode: response.status,
          statusMessage: 'Email is not verified',
        })
      case 401:
        throw createError({
          statusCode: response.status,
          statusMessage: 'Invalid credentials',
        })
      default:
        throw createError({
          statusCode: response.status,
          statusMessage: 'Server error. Please try again later.',
        })
    }
  }

  return response
})
