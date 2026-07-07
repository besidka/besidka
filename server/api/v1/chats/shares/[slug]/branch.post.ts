import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  buildBranchTitle,
  insertBranchedMessages,
} from '~~/server/utils/chats/branch'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { stripFileParts } from '~~/server/utils/files/rewrite-share-file-urls'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

const bodyRules = z.object({
  messageId: z.string().min(1).max(64).optional(),
}).optional()

const BRANCH_COOLDOWN_MS = 30_000

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

  const userId = parseInt(session.user.id)

  logger.set({ userId, shareSlug: params.data.slug })

  const kv = useKV()
  const cooldownKey = `chat-share-branch:${userId}:${params.data.slug}`
  const cooldownValue = await kv.get(cooldownKey)
  const cooldownTimestamp = Number(cooldownValue)
  const cooldownActive = Number.isFinite(cooldownTimestamp)
    && Date.now() - cooldownTimestamp < BRANCH_COOLDOWN_MS

  if (cooldownActive) {
    throw createError({
      message: 'You are branching too quickly',
      status: 429,
      why: 'A branch from this shared chat was created less than 30 seconds ago',
      fix: 'Wait a few seconds, then try again',
    })
  }

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
          id: true,
          publicId: true,
          role: true,
          parts: true,
        },
        orderBy: { createdAt: 'asc' },
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

  const messageId = body.data?.messageId

  let messagesToBranch = persistedMessages

  if (messageId) {
    const branchIndex = persistedMessages.findIndex((message) => {
      return message.publicId === messageId || message.id === messageId
    })

    if (branchIndex === -1) {
      throw createError({
        message: 'Message not found in this shared chat',
        status: 404,
      })
    }

    messagesToBranch = persistedMessages.slice(0, branchIndex + 1)
  }

  const sharedMessages = share.showFiles
    ? messagesToBranch
    : stripFileParts(messagesToBranch)

  const title = buildBranchTitle(sourceChat.title)

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

  await insertBranchedMessages(
    db,
    newChat.id,
    sharedMessages.map((message) => {
      return {
        role: message.role,
        parts: message.parts,
      }
    }),
  )

  await kv.put(cooldownKey, String(Date.now()), { expirationTtl: 60 })

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
