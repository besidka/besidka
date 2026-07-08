import type { TextUIPart, UIMessage } from 'ai'
import type { H3Event } from 'h3'
import type { Model } from '#shared/types/providers.d'
import type {
  ResearchAnswer,
  ResearchJobStatus,
  ResearchJobView,
  ResearchLevel,
  ResearchProviderId,
} from '#shared/types/research.d'
import { getModel } from '#shared/utils/model'
import { getModelResearch } from '#shared/utils/research'
import { createError } from 'evlog'
import { and, count, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { mapResearchProviderError, normalizeChatError } from '~~/server/utils/chats/errors'
import { buildResearchAssistModelInstance } from '~~/server/utils/research/assist-model'
import { getResearchAdapter } from '~~/server/utils/research/adapters'
import { getDecryptedProviderKey } from '~~/server/utils/research/keys'
import { rewriteResearchBrief } from '~~/server/utils/research/clarify'
import { toResearchJobView } from '~~/server/utils/research/job-view'
import type { ResearchAdapter } from '~~/server/utils/research/types.d'

const MAX_ACTIVE_RESEARCH_JOBS_PER_USER = 3
const ACTIVE_RESEARCH_JOB_STATUSES: ResearchJobStatus[] = [
  'pending',
  'running',
]

export interface StartResearchJobInput {
  db: ReturnType<typeof useDb>
  event: H3Event
  logger: { set: (fields: Record<string, unknown>) => void }
  userId: number
  chat: {
    id: string
    slug: string
    projectId: string | null
  }
  userMessage: {
    id: string
    parts: UIMessage['parts']
  }
  model: string
  answers?: ResearchAnswer[]
}

export interface StartResearchJobResult {
  job: ResearchJobView
}

export interface ResolveResearchStartContextInput {
  userId: number
  model: string
}

export interface ResearchStartContext {
  provider: { id: string, name: string }
  model: Model
  research: NonNullable<ReturnType<typeof getModelResearch>>
  supportedProviderId: ResearchProviderId
  apiKey: string
}

export async function resolveResearchStartContext(
  input: ResolveResearchStartContextInput,
): Promise<ResearchStartContext> {
  const { model, provider } = getModel(input.model)

  if (!model || !provider) {
    throw createError({
      message: 'Please select a model to continue.',
      status: 400,
      why: 'The selected model is not supported by any provider.',
      fix: 'Select a different model and try again.',
    })
  }

  const research = getModelResearch(model)
  const supportedProviderId = toSupportedResearchProviderId(provider.id)

  if (!research || !supportedProviderId) {
    throw createError({
      message: 'This model does not support deep research.',
      status: 400,
      why: 'The selected model has no deep research capability.',
      fix: 'Select one of the dedicated deep research models.',
    })
  }

  const apiKey = await getDecryptedProviderKey(
    input.userId,
    supportedProviderId,
  )

  if (!apiKey) {
    throw createError({
      message: `${provider.name} API key not found.`,
      status: 401,
      why: 'No saved API key for this provider.',
      fix: `Add your ${provider.name} API key in settings, then try again.`,
    })
  }

  return {
    provider,
    model,
    research,
    supportedProviderId,
    apiKey,
  }
}

export async function startResearchJobForChat(
  input: StartResearchJobInput,
): Promise<StartResearchJobResult> {
  const {
    model, research, supportedProviderId, apiKey,
  } = await resolveResearchStartContext({
    userId: input.userId,
    model: input.model,
  })

  await assertResearchJobCapacity(input.db, input.userId)

  const job = await claimResearchJob(input.db, {
    chatId: input.chat.id,
    userId: input.userId,
    userMessageId: input.userMessage.id,
    provider: supportedProviderId,
    level: research.tier,
    modelId: model.id,
  })

  const adapter = getResearchAdapter(supportedProviderId)

  try {
    const assistInstance = await buildResearchAssistModelInstance(
      input.userId,
      supportedProviderId,
      research.assistModel,
    )
    const topic = getUserMessageText(input.userMessage.parts)
    const brief = await rewriteResearchBrief({
      instance: assistInstance,
      topic,
      answers: input.answers ?? [],
    })

    const started = await adapter.start({
      apiKey,
      modelId: model.id,
      tier: research.tier,
      maxToolCalls: research.maxToolCalls,
      brief,
    })
    const startedAt = new Date()

    let claimed: { id: string } | undefined

    try {
      claimed = await input.db.update(schema.researchJobs)
        .set({
          providerJobId: started.providerJobId,
          status: started.status,
          startedAt,
        })
        .where(and(
          eq(schema.researchJobs.id, job.id),
          inArray(schema.researchJobs.status, ACTIVE_RESEARCH_JOB_STATUSES),
        ))
        .returning({ id: schema.researchJobs.id })
        .get()
    } catch (updateException) {
      await cancelStartedProviderJobBestEffort(
        adapter,
        started.providerJobId,
        apiKey,
        input.logger,
      )

      throw updateException
    }

    if (!claimed) {
      await cancelStartedProviderJobBestEffort(
        adapter,
        started.providerJobId,
        apiKey,
        input.logger,
      )

      const currentJob = await input.db.query.researchJobs.findFirst({
        where: { id: job.id },
      })

      if (!currentJob) {
        throw createError({
          message: 'The research job could not be found.',
          status: 404,
          why: 'The research job was removed before it could start.',
        })
      }

      input.logger.set({
        research: {
          phase: 'start',
          jobId: job.id,
          status: currentJob.status,
          note: 'job left the active state before the provider job'
            + ' could be stored',
        },
      })

      return { job: toResearchJobView(currentJob) }
    }

    input.logger.set({
      research: {
        phase: 'start',
        jobId: job.id,
        provider: supportedProviderId,
        level: research.tier,
        modelId: model.id,
        status: started.status,
      },
    })

    return {
      job: {
        publicId: job.id,
        status: started.status,
        provider: supportedProviderId,
        level: research.tier,
        modelId: model.id,
        startedAt: startedAt.getTime(),
        error: null,
        resultMessageId: null,
      },
    }
  } catch (exception) {
    const chatError = mapResearchProviderError({
      error: exception,
      providerId: supportedProviderId,
      event: input.event,
      code: 'research-start-failed',
      message: 'Could not start the research job.',
    })

    await input.db.update(schema.researchJobs)
      .set({
        status: 'failed',
        error: chatError,
        completedAt: new Date(),
      })
      .where(and(
        eq(schema.researchJobs.id, job.id),
        inArray(schema.researchJobs.status, ACTIVE_RESEARCH_JOB_STATUSES),
      ))

    input.logger.set({
      research: {
        phase: 'start',
        jobId: job.id,
        errorCode: chatError.code,
        errorMessage: chatError.why,
      },
    })

    throw createError({ ...chatError })
  }
}

async function cancelStartedProviderJobBestEffort(
  adapter: ResearchAdapter,
  providerJobId: string,
  apiKey: string,
  logger: StartResearchJobInput['logger'],
): Promise<void> {
  try {
    await adapter.cancel(providerJobId, apiKey)
  } catch (exception) {
    logger.set({
      research: {
        phase: 'start-cancel',
        providerJobId,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }
}

async function assertResearchJobCapacity(
  db: ReturnType<typeof useDb>,
  userId: number,
): Promise<void> {
  const [activeJobCount] = await db
    .select({ total: count() })
    .from(schema.researchJobs)
    .where(and(
      eq(schema.researchJobs.userId, userId),
      inArray(schema.researchJobs.status, ACTIVE_RESEARCH_JOB_STATUSES),
    ))

  if ((activeJobCount?.total ?? 0) >= MAX_ACTIVE_RESEARCH_JOBS_PER_USER) {
    throw createError({
      message: 'Too many active research jobs.',
      status: 429,
      why: 'You can run up to 3 research jobs at the same time.',
      fix: 'Wait for a running research job to finish or cancel one.',
    })
  }
}

async function claimResearchJob(
  db: ReturnType<typeof useDb>,
  values: {
    chatId: string
    userId: number
    userMessageId: string
    provider: ResearchProviderId
    level: ResearchLevel
    modelId: string
  },
): Promise<{ id: string }> {
  try {
    return await db.insert(schema.researchJobs)
      .values({
        ...values,
        status: 'pending',
      })
      .returning({ id: schema.researchJobs.id })
      .get()
  } catch (exception) {
    if (isActiveResearchJobConflict(exception)) {
      throw createError({
        message: 'A research job is already running for this chat.',
        status: 409,
        why: 'Only one active research job is allowed per chat.',
        fix: 'Wait for the current research to finish or cancel it first.',
      })
    }

    throw createError({
      ...normalizeChatError({
        error: exception,
        code: 'research-start-failed',
        message: 'Could not start the research job.',
        status: 500,
      }),
    })
  }
}

function isActiveResearchJobConflict(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false
  }

  return /unique constraint/i.test(exception.message)
    && exception.message.includes('research_jobs')
}

function getUserMessageText(parts: UIMessage['parts']): string {
  return parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map(part => part.text.trim())
    .join('\n')
}

function toSupportedResearchProviderId(
  providerId: string,
): ResearchProviderId | undefined {
  if (providerId !== 'openai' && providerId !== 'google') {
    return undefined
  }

  return providerId
}
