import type { BatchItem } from 'drizzle-orm/batch'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const secFetchSite = getHeader(event, 'sec-fetch-site')

  if (secFetchSite === 'cross-site') {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `sec-fetch-site "${secFetchSite}" is cross-site`,
    })
  }

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

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  logger.set({ userId, shareSlug: params.data.slug })

  const share = await resolveActiveShareBySlug(
    params.data.slug,
    event,
  )

  if (!share) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  if (!share.allowBranch) {
    throw createError({
      message: 'Branching is disabled for this shared chat',
      status: 403,
      why: 'The share owner has turned off branching for this link',
    })
  }

  const db = useDb()

  const sourceChat = await db.query.chats.findFirst({
    where: { id: share.chatId },
    columns: {
      id: true,
      title: true,
    },
    with: {
      messages: {
        columns: {
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
        },
      },
    },
  })

  if (!sourceChat) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const persistedMessages = sourceChat.messages.filter((message) => {
    return isPersistedMessageRole(message.role)
  })

  const title = sourceChat.title
    ? `Branch: ${sourceChat.title.replace(/Branch: /g, '')}`
    : 'Branch'

  const newChat = await db
    .insert(schema.chats)
    .values({
      userId,
      title,
      branchedFromShareSlug: params.data.slug,
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  if (persistedMessages.length > 0) {
    const messageInserts = persistedMessages.map((message) => {
      return db
        .insert(schema.messages)
        .values({
          chatId: newChat.id,
          role: message.role,
          parts: message.parts,
          tools: message.tools,
          reasoning: message.reasoning,
        })
    }) as unknown as [BatchItem<'sqlite'>]

    await db.batch(messageInserts)
  }

  type WaitUntilCtx = {
    cloudflare?: {
      context?: {
        waitUntil?: (promise: Promise<unknown>) => void
      }
    }
  }

  const cfCtx = (event.context as WaitUntilCtx | undefined)?.cloudflare?.context

  if (cfCtx?.waitUntil) {
    const runtimeConfig = useRuntimeConfig()

    cfCtx.waitUntil(sendPushNotificationToUser(
      db,
      userId,
      {
        title: 'Added to your chats',
        body: 'Your shared chat is ready in Besidka.',
        url: `/chats/${newChat.slug}`,
      },
      {
        subject: buildVapidSubject(runtimeConfig.vapidSubject),
        publicKey: runtimeConfig.public.vapidPublicKey || undefined,
        privateKey: runtimeConfig.vapidPrivateKey || undefined,
      },
      cfCtx.waitUntil.bind(cfCtx),
    ))
  }

  return { slug: newChat.slug }
})
