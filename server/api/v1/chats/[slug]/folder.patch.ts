import { and, eq, sql } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    folderId: z.string().nonempty().nullable(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  logger.set({
    userId,
    slug: params.data.slug,
    folderId: body.data.folderId,
  })

  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
    },
    columns: { id: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  if (body.data.folderId !== null) {
    const folder = await db.query.folders.findFirst({
      where(folders, { and, eq }) {
        return and(
          eq(folders.id, body.data.folderId!),
          eq(folders.userId, userId),
        )
      },
      columns: { id: true },
    })

    if (!folder) {
      throw createError({
        message: 'Folder not found',
        status: 403,
        why: 'Folder does not exist or does not belong to user',
      })
    }

    await db.update(schema.chats)
      .set({ folderId: folder.id, activityAt: new Date() })
      .where(and(
        eq(schema.chats.id, chat.id),
        eq(schema.chats.userId, userId),
      ))

    await db.update(schema.folders)
      .set({ activityAt: new Date() })
      .where(eq(schema.folders.id, folder.id))

    return { folderId: folder.id }
  }

  await db.update(schema.chats)
    .set({ folderId: sql`NULL`, activityAt: new Date() })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  return { folderId: null }
})
