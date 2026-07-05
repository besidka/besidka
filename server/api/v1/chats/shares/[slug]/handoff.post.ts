import { createError, useLogger } from 'evlog'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

/**
 * POST /chats/shares/:slug/handoff
 *
 * iOS cannot open an external link inside an installed PWA, so this endpoint
 * lets a logged-in visitor on the public shared page send themselves a Web
 * Push whose tap opens the shared chat inside their installed app. Responds
 * with { sent: false } when the account has no push subscription so the UI
 * can explain how to enable it.
 */
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

  const kv = useKV()
  const cooldownKey = `chat-share-handoff:${userId}`
  const cooldownActive = await kv.get(cooldownKey)

  if (cooldownActive) {
    throw createError({
      message: 'Notification already sent',
      status: 429,
      why: 'A handoff notification was requested less than a minute ago',
      fix: 'Wait a minute, then try again',
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

  const db = useDb()

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: { userId },
    columns: { id: true },
  })

  if (subscriptions.length === 0) {
    logger.set({ handoff: { sent: false, reason: 'no-subscriptions' } })

    return { sent: false }
  }

  type WaitUntilCtx = {
    cloudflare?: {
      context?: {
        waitUntil?: (promise: Promise<unknown>) => void
      }
    }
  }

  const cfCtx = (event.context as WaitUntilCtx | undefined)?.cloudflare?.context

  if (!cfCtx?.waitUntil) {
    logger.set({ handoff: { sent: false, reason: 'no-wait-until' } })

    return { sent: false }
  }

  await kv.put(cooldownKey, '1', { expirationTtl: 60 })

  const runtimeConfig = useRuntimeConfig()
  const shareSlug = share.slug ?? params.data.slug

  cfCtx.waitUntil(sendPushNotificationToUser(
    db,
    userId,
    {
      title: 'Shared chat ready',
      body: 'Tap to open the shared chat in Besidka.',
      url: `/shared/${shareSlug}`,
    },
    {
      subject: buildVapidSubject(runtimeConfig.vapidSubject),
      publicKey: runtimeConfig.public.vapidPublicKey || undefined,
      privateKey: runtimeConfig.vapidPrivateKey || undefined,
    },
    cfCtx.waitUntil.bind(cfCtx),
  ))

  logger.set({ handoff: { sent: true } })

  return { sent: true }
})
