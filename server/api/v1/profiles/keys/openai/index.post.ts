import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    projectId: z.string().nonempty(),
    apiKey: z.string().nonempty(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession(event)

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()

  const existingKey = await db.query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(session.user.id)),
        eq(keys.provider, 'openai'),
      )
    },
  })

  const apiKey = await useEncryptText(body.data.apiKey)
  const projectId = await useEncryptText(body.data.projectId)

  if (existingKey) {
    await db.update(schema.keys).set({
      apiKey,
      projectId,
    }).where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'openai'),
    ))

    return setResponseStatus(event, 204, 'Key updated successfully')
  }

  await db.insert(schema.keys).values({
    userId: parseInt(session.user.id),
    provider: 'openai',
    apiKey,
    projectId,
  })

  return setResponseStatus(event, 201, 'Key created successfully')
})
