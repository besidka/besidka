import { useLogger } from 'evlog'

/**
 * GET /push/status
 *
 * Reports whether the current user has at least one push subscription, so
 * the client can decide whether it is worth offering push-dependent actions
 * (like sending a shared chat handoff notification to the installed app).
 */
export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  const subscriptions = await useDb().query.pushSubscriptions.findMany({
    where: { userId },
    columns: { id: true },
  })

  const subscribed = subscriptions.length > 0

  logger.set({ push: { operation: 'status', subscribed } })

  return { subscribed }
})
