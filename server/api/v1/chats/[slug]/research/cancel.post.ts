import { useLogger, createError } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { getResearchAdapter } from '~~/server/utils/research/adapters'
import { getDecryptedProviderKey } from '~~/server/utils/research/keys'
import { toResearchJobView } from '~~/server/utils/research/job-view'

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

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const db = useDb()
  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: { id: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  const job = await db.query.researchJobs.findFirst({
    where: { chatId: chat.id },
    orderBy: { id: 'desc' },
  })

  if (!job || job.userId !== userId) {
    throw createError({
      message: 'No research job found for this chat.',
      status: 404,
    })
  }

  logger.set({
    userId,
    chatId: chat.id,
    jobId: job.id,
    operation: 'research-cancel',
  })

  if (job.status !== 'pending' && job.status !== 'running') {
    return { job: toResearchJobView(job) }
  }

  if (job.providerJobId) {
    const apiKey = await getDecryptedProviderKey(userId, job.provider)

    if (apiKey) {
      try {
        await getResearchAdapter(job.provider).cancel(
          job.providerJobId,
          apiKey,
        )
      } catch (exception) {
        logger.set({
          research: {
            phase: 'cancel',
            jobId: job.id,
            error: exception instanceof Error
              ? exception.message
              : String(exception),
          },
        })
      }
    }
  }

  const updated = await db.update(schema.researchJobs)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(schema.researchJobs.id, job.id))
    .returning()
    .get()

  return { job: toResearchJobView(updated ?? { ...job, status: 'cancelled' as const }) }
})
