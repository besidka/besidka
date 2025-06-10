const rules = z.object({
  name: z.string().min(2),
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

  const response = await useServerAuth().api.signUpEmail({
    body: body.data,
    asResponse: true,
  })

  if (!response.ok) {
    if (response.status === 422) {
      throw createError({
        statusCode: response.status,
        statusMessage: 'User already exists',
      })
    } else {
      throw createError({
        statusCode: response.status,
        statusMessage: 'Unknown error',
      })
    }
  }

  return response
})
