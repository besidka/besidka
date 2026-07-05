import { eq } from 'drizzle-orm'
import { createError, useLogger } from 'evlog'
import { ulid } from 'ulid'
import * as schema from '~~/server/db/schema'
import {
  durationToExpiresAt,
  syncChatShareFiles,
} from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.ulid(),
})

const bodyRules = z.object({
  duration: z.enum(['week', 'month', 'year', 'forever']),
  indexable: z.boolean(),
  showFiles: z.boolean(),
  showMetadata: z.boolean(),
})

interface ChatShareOptions {
  expiresAt: Date | null
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
}

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

  const options: ChatShareOptions = {
    expiresAt: durationToExpiresAt(body.data.duration),
    indexable: body.data.indexable,
    showFiles: body.data.showFiles,
    showMetadata: body.data.showMetadata,
  }

  const existingShare = await db.query.chatShares.findFirst({
    where: { chatId: chat.id },
    columns: { id: true, slug: true },
    orderBy: { createdAt: 'desc' },
  })

  const share = existingShare
    ? await updateChatShare(db, existingShare, options)
    : await createChatShare(db, chat.id, options)

  await syncChatShareFiles(share.id, chat.id, userId, event)

  await db.update(schema.chats)
    .set({ shared: true })
    .where(eq(schema.chats.id, chat.id))

  const baseUrl = (useRuntimeConfig().public.baseUrl as string)
    .replace(/\/$/, '')

  return {
    slug: share.slug,
    url: `${baseUrl}/shared/${share.slug}`,
    expiresAt: options.expiresAt,
    indexable: options.indexable,
    showFiles: options.showFiles,
    showMetadata: options.showMetadata,
  }
})

interface ChatShareIdentity {
  id: string
  slug: string
}

interface ExistingChatShare {
  id: string
  slug: string | null
}

async function updateChatShare(
  db: ReturnType<typeof useDb>,
  existingShare: ExistingChatShare,
  options: ChatShareOptions,
): Promise<ChatShareIdentity> {
  const slug = existingShare.slug ?? ulid()

  await db.update(schema.chatShares)
    .set({
      revoked: false,
      slug,
      ...options,
    })
    .where(eq(schema.chatShares.id, existingShare.id))

  return { id: existingShare.id, slug }
}

async function createChatShare(
  db: ReturnType<typeof useDb>,
  chatId: string,
  options: ChatShareOptions,
): Promise<ChatShareIdentity> {
  const slug = ulid()

  const share = await db
    .insert(schema.chatShares)
    .values({
      chatId,
      slug,
      ...options,
    })
    .returning({ id: schema.chatShares.id })
    .get()

  return { id: share.id, slug }
}
