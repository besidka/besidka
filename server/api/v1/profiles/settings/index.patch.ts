import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    reasoningExpanded: z.boolean(),
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
  const userId = parseInt(session.user.id)
  const existingSettings = await db.query.userSettings.findFirst({
    where(userSettings, { eq }) {
      return eq(userSettings.userId, userId)
    },
    columns: {
      id: true,
    },
  })

  if (existingSettings) {
    await db.update(schema.userSettings).set({
      reasoningExpanded: body.data.reasoningExpanded,
    }).where(eq(schema.userSettings.userId, userId))
  } else {
    await db.insert(schema.userSettings).values({
      userId,
      reasoningExpanded: body.data.reasoningExpanded,
    })
  }

  return {
    reasoningExpanded: body.data.reasoningExpanded,
  }
})
