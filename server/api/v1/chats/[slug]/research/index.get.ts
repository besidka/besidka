import type {
  ResearchJobStatus,
  ResearchTraceEntry,
} from '#shared/types/research.d'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { finalizeResearchJob } from '~~/server/utils/research/finalize'
import { toResearchJobView } from '~~/server/utils/research/job-view'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

type WaitUntilCtx = {
  cloudflare?: {
    context?: {
      waitUntil?: (promise: Promise<unknown>) => void
    }
  }
}

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
    columns: { id: true, slug: true },
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
    operation: 'research-status',
  })

  if (isTerminalResearchStatus(job.status)) {
    return await buildResearchStatusResponse(db, job)
  }

  const cfCtx = (event.context as WaitUntilCtx | undefined)?.cloudflare?.context
  const runtimeConfig = useRuntimeConfig()
  let currentStep: ResearchTraceEntry | undefined

  try {
    const finalizeResult = await finalizeResearchJob({
      db,
      job,
      logger,
      waitUntil: cfCtx?.waitUntil?.bind(cfCtx),
      vapid: {
        subject: buildVapidSubject(runtimeConfig.vapidSubject),
        publicKey: runtimeConfig.public.vapidPublicKey || undefined,
        privateKey: runtimeConfig.vapidPrivateKey || undefined,
      },
    })

    currentStep = finalizeResult.currentStep
  } catch (exception) {
    logger.set({
      research: {
        phase: 'finalize',
        jobId: job.id,
      },
      attributes: {
        research: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  const refreshedJob = await db.query.researchJobs.findFirst({
    where: { id: job.id },
  })
  const targetJob = refreshedJob ?? job
  const response = await buildResearchStatusResponse(db, targetJob)

  if (!isTerminalResearchStatus(targetJob.status) && currentStep) {
    return { ...response, currentStep }
  }

  return response
})

function isTerminalResearchStatus(status: ResearchJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

async function buildResearchStatusResponse(
  db: ReturnType<typeof useDb>,
  job: typeof schema.researchJobs.$inferSelect,
) {
  const jobView = toResearchJobView(job)

  if (job.status !== 'completed' || !job.resultMessageId) {
    return { job: jobView }
  }

  const message = await db.query.messages.findFirst({
    where: { publicId: job.resultMessageId },
    columns: {
      id: true,
      publicId: true,
      role: true,
      parts: true,
      tools: true,
      reasoning: true,
      createdAt: true,
      usage: true,
    },
  })

  if (!message) {
    return { job: jobView }
  }

  return {
    job: jobView,
    message: {
      ...message,
      id: message.publicId ?? message.id,
    },
  }
}
