import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    reasoningExpanded: z.boolean().optional(),
    allowExternalLinks: z.boolean().nullable().optional(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
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

  const fieldUpdates: {
    reasoningExpanded?: boolean
    allowExternalLinks?: boolean | null
  } = {}

  if (body.data.reasoningExpanded !== undefined) {
    fieldUpdates.reasoningExpanded = body.data.reasoningExpanded
  }

  if ('allowExternalLinks' in body.data) {
    fieldUpdates.allowExternalLinks = body.data.allowExternalLinks ?? null
  }

  if (Object.keys(fieldUpdates).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No fields to update',
    })
  }

  if (existingSettings) {
    await db.update(schema.userSettings).set(fieldUpdates)
      .where(eq(schema.userSettings.userId, userId))
  } else {
    await db.insert(schema.userSettings).values({
      userId,
      ...fieldUpdates,
    })
  }

  return fieldUpdates
})
