import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    apiKey: z.string().nonempty(),
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

  const existingKey = await db.query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(session.user.id)),
        eq(keys.provider, 'google'),
      )
    },
  })

  const apiKey = await useEncryptText(body.data.apiKey)

  if (existingKey) {
    await db.update(schema.keys).set({
      apiKey,
    }).where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'google'),
    ))

    return setResponseStatus(event, 204, 'Key updated successfully')
  }

  await db.insert(schema.keys).values({
    userId: parseInt(session.user.id),
    provider: 'google',
    apiKey,
  })

  return setResponseStatus(event, 201, 'Key created successfully')
})
