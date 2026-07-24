import { createError, useLogger } from 'evlog'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

const HANDOFF_COOLDOWN_MS = 10_000

/**
 * POST /chats/shares/:slug/handoff
 *
 * iOS cannot open an external link inside an installed PWA, so this endpoint
 * lets a logged-in visitor on the public shared page send themselves a Web
 * Push whose tap opens the shared chat inside their installed app. The send
 * is awaited so the response reflects the real outcome: { sent: true } only
 * when at least one push service accepted the notification, otherwise
 * { sent: false, reason: 'not-configured' | 'no-subscriptions'
 * | 'delivery-failed' } so the UI can explain what to do.
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
  const cooldownValue = await kv.get(cooldownKey)
  const cooldownTimestamp = Number(cooldownValue)
  const cooldownActive = Number.isFinite(cooldownTimestamp)
    && Date.now() - cooldownTimestamp < HANDOFF_COOLDOWN_MS

  if (cooldownActive) {
    throw createError({
      message: 'Notification already sent',
      status: 429,
      why: 'A handoff notification was requested less than 10 seconds ago',
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

  const runtimeConfig = useRuntimeConfig()
  const vapid = {
    subject: buildVapidSubject(runtimeConfig.vapidSubject),
    publicKey: runtimeConfig.public.vapidPublicKey || undefined,
    privateKey: runtimeConfig.vapidPrivateKey || undefined,
  }

  if (!isPushConfigured(vapid)) {
    logger.set({ handoff: { sent: false, reason: 'not-configured' } })

    return { sent: false, reason: 'not-configured' as const }
  }

  const db = useDb()

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: { userId },
    columns: { id: true },
  })

  if (subscriptions.length === 0) {
    logger.set({ handoff: { sent: false, reason: 'no-subscriptions' } })

    return { sent: false, reason: 'no-subscriptions' as const }
  }

  type WaitUntilCtx = {
    cloudflare?: {
      context?: {
        waitUntil?: (promise: Promise<unknown>) => void
      }
    }
  }

  const cfCtx = (event.context as WaitUntilCtx | undefined)?.cloudflare?.context
  const waitUntil = cfCtx?.waitUntil
    ? cfCtx.waitUntil.bind(cfCtx)
    : undefined
  const shareSlug = share.slug ?? params.data.slug

  // Awaited, not fire-and-forget: the whole point of this endpoint is the
  // caller finding out whether a push actually reached the push service, so
  // the response must reflect the real delivery outcome.
  const outcomes = await sendPushNotificationToUser(
    db,
    userId,
    {
      title: 'Shared chat ready',
      body: 'Tap to open the shared chat in Besidka.',
      url: `/shared/${shareSlug}`,
    },
    vapid,
    waitUntil,
  )

  if (!outcomes) {
    logger.set({ handoff: { sent: false, reason: 'not-configured' } })

    return { sent: false, reason: 'not-configured' as const }
  }

  const sent = outcomes.sent > 0
  const { failures, ...outcomeCounts } = outcomes

  logger.set({
    handoff: { sent, outcomes: outcomeCounts },
    attributes: { handoff: { failures } },
  })

  if (!sent) {
    return {
      sent: false,
      reason: 'delivery-failed' as const,
      failures: outcomes.failures,
    }
  }

  await kv.put(cooldownKey, String(Date.now()), { expirationTtl: 60 })

  return { sent: true, reason: null }
})
