import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const paramsSchema = z.object({
  id: z.string().min(1),
})

const bodySchema = z.object({
  name: z.string().min(1).max(255),
})

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(event.context.params)

  if (!params.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request parameters',
      data: params.error.flatten(),
    })
  }

  const rawBody = await readBody(event)
  const body = bodySchema.safeParse(rawBody)

  if (!body.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error.flatten(),
    })
  }

  const { id } = params.data
  const { name } = body.data
  const userId = parseInt(session.user.id)
  const db = useDb()

  const result = await db
    .update(schema.files)
    .set({ name })
    .where(and(
      eq(schema.files.id, id),
      eq(schema.files.userId, userId),
    ))
    .returning({
      id: schema.files.id,
      name: schema.files.name,
    })
    .get()

  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found',
    })
  }

  return result
})
