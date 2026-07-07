import { eq } from 'drizzle-orm'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  durationToExpiresAt,
  syncChatShareFiles,
} from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.ulid(),
})

const bodyRules = z.object({
  duration: z.enum(['hour', 'day', 'week', 'month', 'year', 'never']),
  indexable: z.boolean(),
  showFiles: z.boolean(),
  showMetadata: z.boolean(),
  showAuthorAvatar: z.boolean(),
  allowBranch: z.boolean(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(
    event,
    paramsRules.safeParse,
  )

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, bodyRules.safeParse)

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
    chatSlug: params.data.slug,
    duration: body.data.duration,
  })

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const expiresAt = durationToExpiresAt(body.data.duration)

  const shareRow = await db
    .insert(schema.chatShares)
    .values({
      chatId: chat.id,
      indexable: body.data.indexable,
      showFiles: body.data.showFiles,
      showMetadata: body.data.showMetadata,
      showAuthorAvatar: body.data.showAuthorAvatar,
      allowBranch: body.data.allowBranch,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: schema.chatShares.chatId,
      set: {
        revoked: false,
        indexable: body.data.indexable,
        showFiles: body.data.showFiles,
        showMetadata: body.data.showMetadata,
        showAuthorAvatar: body.data.showAuthorAvatar,
        allowBranch: body.data.allowBranch,
        expiresAt,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: schema.chatShares.id,
      slug: schema.chatShares.slug,
    })
    .get()

  if (!shareRow.slug) {
    throw createError({
      message: 'Failed to generate a share link',
      status: 500,
      why: 'Share row is missing a slug after upsert',
    })
  }

  const shareId = shareRow.id
  const slug = shareRow.slug

  await syncChatShareFiles(
    shareId,
    chat.id,
    userId,
    body.data.showFiles,
    event,
  )

  await db.update(schema.chats)
    .set({ shared: true })
    .where(eq(schema.chats.id, chat.id))

  const baseUrl = (useRuntimeConfig().public.baseUrl as string)
    .replace(/\/$/, '')

  return {
    slug,
    url: `${baseUrl}/shared/${slug}`,
    expiresAt,
    indexable: body.data.indexable,
    showFiles: body.data.showFiles,
    showMetadata: body.data.showMetadata,
    showAuthorAvatar: body.data.showAuthorAvatar,
    allowBranch: body.data.allowBranch,
  }
})
