import type { LanguageModelUsage, UIMessage } from 'ai'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type {
  ResearchJobStatus,
  ResearchMetadata,
  ResearchProviderId,
  ResearchUsage,
} from '#shared/types/research.d'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as schema from '~~/server/db/schema'
import { buildMessageUsage } from '~~/server/utils/ai/message-usage'
import {
  mapResearchProviderError,
  normalizeChatError,
} from '~~/server/utils/chats/errors'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { getResearchAdapter } from '~~/server/utils/research/adapters'
import { mockResearchAdapter } from '~~/server/utils/research/adapters/mock'
import { describeResearchAdapterException } from '~~/server/utils/research/adapter-error'
import { getDecryptedProviderKey } from '~~/server/utils/research/keys'
import type { ResearchFinalResult } from '~~/server/utils/research/types.d'
import type { VapidKeys } from '~~/server/utils/push'

const OVERALL_CAP_MS = 90 * 60 * 1000

export type FinalizeResearchJobOutcome
  = | 'finalized'
    | 'already-finalized'
    | 'still-running'
    | 'failed'

export interface FinalizeResearchJobInput {
  db: ReturnType<typeof useDb>
  job: typeof schema.researchJobs.$inferSelect
  vapid: VapidKeys
  waitUntil?: (promise: Promise<unknown>) => void
  logger: { set: (fields: Record<string, unknown>) => void }
}

export async function finalizeResearchJob(
  input: FinalizeResearchJobInput,
): Promise<FinalizeResearchJobOutcome> {
  const { db, job, logger } = input

  if (job.status === 'completed' && job.resultMessageId) {
    return 'already-finalized'
  }

  if (job.status === 'failed' || job.status === 'cancelled') {
    return 'failed'
  }

  if (!job.providerJobId) {
    await markJobTerminal(db, job.id, 'failed', buildStartIncompleteError())

    return 'failed'
  }

  const apiKey = await getDecryptedProviderKey(job.userId, job.provider)

  if (!apiKey) {
    await markJobTerminal(
      db,
      job.id,
      'failed',
      buildKeyMissingError(job.provider),
    )

    return 'failed'
  }

  const runtimeConfig = useRuntimeConfig()
  const useMockAdapter = runtimeConfig.researchMockEnabled
    && job.providerJobId.startsWith('mock_')
  const adapter = useMockAdapter
    ? mockResearchAdapter
    : getResearchAdapter(job.provider)
  let statusResult

  try {
    statusResult = await adapter.status(job.providerJobId, apiKey)
  } catch (exception) {
    const exceptionDetails = describeResearchAdapterException(exception)

    logger.set({
      research: {
        phase: 'poll',
        jobId: job.id,
        errorStatus: exceptionDetails.status,
        error: exceptionDetails.message,
      },
    })

    if (exceptionDetails.status === 404) {
      await markJobTerminal(
        db,
        job.id,
        'failed',
        buildProviderJobGoneError(job.provider),
      )

      return 'failed'
    }

    if (exceptionDetails.status === 401 || exceptionDetails.status === 403) {
      await markJobTerminal(
        db,
        job.id,
        'failed',
        mapResearchProviderError({
          error: exception,
          providerId: job.provider,
          code: 'provider-auth',
          message: 'The research provider rejected access to this job.',
        }),
      )

      return 'failed'
    }

    if (hasExceededOverallCap(job)) {
      await markJobTerminal(db, job.id, 'failed', buildTimeoutError())

      return 'failed'
    }

    await touchResearchJob(db, job.id)

    return 'still-running'
  }

  if (statusResult.status === 'running') {
    if (hasExceededOverallCap(job)) {
      try {
        await adapter.cancel(job.providerJobId, apiKey)
      } catch (exception) {
        const exceptionDetails = describeResearchAdapterException(exception)

        logger.set({
          research: {
            phase: 'timeout-cancel',
            jobId: job.id,
            errorStatus: exceptionDetails.status,
            error: exceptionDetails.message,
          },
        })
      }

      await markJobTerminal(db, job.id, 'failed', buildTimeoutError())

      return 'failed'
    }

    await touchResearchJob(db, job.id)

    return 'still-running'
  }

  if (statusResult.status === 'cancelled') {
    await markJobTerminal(
      db,
      job.id,
      'cancelled',
      buildProviderCancelledError(),
    )

    return 'failed'
  }

  if (statusResult.status !== 'completed') {
    await markJobTerminal(
      db,
      job.id,
      'failed',
      buildProviderFailureError(job.provider, statusResult.raw),
    )

    return 'failed'
  }

  let result: ResearchFinalResult

  try {
    result = await adapter.result(job.providerJobId, apiKey)
  } catch (exception) {
    const exceptionDetails = describeResearchAdapterException(exception)

    logger.set({
      research: {
        phase: 'result',
        jobId: job.id,
        errorStatus: exceptionDetails.status,
        error: exceptionDetails.message,
      },
    })

    await touchResearchJob(db, job.id)

    return 'still-running'
  }

  const assistantPublicId = ulid()
  const durationMs = job.startedAt
    ? Date.now() - job.startedAt.getTime()
    : undefined

  const claimed = await db
    .update(schema.researchJobs)
    .set({
      status: 'completed',
      resultMessageId: assistantPublicId,
      usage: result.usage ?? null,
      completedAt: new Date(),
    })
    .where(and(
      eq(schema.researchJobs.id, job.id),
      isNull(schema.researchJobs.resultMessageId),
      inArray(schema.researchJobs.status, ['pending', 'running']),
    ))
    .returning({ id: schema.researchJobs.id })
    .get()

  if (!claimed) {
    return 'already-finalized'
  }

  const parts = buildResearchAssistantParts({ result, job, durationMs })
  const messageUsage = buildMessageUsage(
    toLanguageModelUsage(result.usage),
    job.modelId,
    job.provider,
  )

  try {
    await insertMessageWithPublicId({
      db,
      values: {
        chatId: job.chatId,
        role: 'assistant',
        parts,
        tools: [],
        reasoning: 'off',
        usage: messageUsage ?? null,
      },
      publicId: assistantPublicId,
    })

    await db.update(schema.chats)
      .set({ activityAt: new Date() })
      .where(eq(schema.chats.id, job.chatId))

    const chat = await db.query.chats.findFirst({
      where: { id: job.chatId },
      columns: { slug: true },
    })

    if (chat && input.waitUntil && isPushConfigured(input.vapid)) {
      input.waitUntil(sendPushNotificationToUser(
        db,
        job.userId,
        {
          title: 'Your research is ready',
          body: 'Tap to view your report.',
          url: `/chats/${chat.slug}`,
          tag: 'besidka-research-ready',
        },
        input.vapid,
        input.waitUntil,
        job.origin ?? undefined,
      ))
    }
  } catch (exception) {
    await revertResearchJobCompletionClaim(db, job.id, assistantPublicId)

    logger.set({
      research: {
        phase: 'finalize-persist',
        jobId: job.id,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    return 'still-running'
  }

  logger.set({
    research: {
      phase: 'finalize',
      jobId: job.id,
      sources: result.sources.length,
      durationMs,
    },
  })

  return 'finalized'
}

async function markJobTerminal(
  db: ReturnType<typeof useDb>,
  jobId: string,
  status: ResearchJobStatus,
  error: ChatErrorPayload,
): Promise<void> {
  await db.update(schema.researchJobs)
    .set({
      status,
      error,
      completedAt: new Date(),
    })
    .where(and(
      eq(schema.researchJobs.id, jobId),
      inArray(schema.researchJobs.status, ['pending', 'running']),
    ))
}

function hasExceededOverallCap(
  job: typeof schema.researchJobs.$inferSelect,
): boolean {
  const startedAt = job.startedAt?.getTime() ?? job.createdAt.getTime()

  return Date.now() - startedAt > OVERALL_CAP_MS
}

async function touchResearchJob(
  db: ReturnType<typeof useDb>,
  jobId: string,
): Promise<void> {
  await db.update(schema.researchJobs)
    .set({ updatedAt: new Date() })
    .where(and(
      eq(schema.researchJobs.id, jobId),
      inArray(schema.researchJobs.status, ['pending', 'running']),
    ))
}

async function revertResearchJobCompletionClaim(
  db: ReturnType<typeof useDb>,
  jobId: string,
  claimedResultMessageId: string,
): Promise<void> {
  await db.update(schema.researchJobs)
    .set({
      status: 'running',
      resultMessageId: null,
      completedAt: null,
    })
    .where(and(
      eq(schema.researchJobs.id, jobId),
      eq(schema.researchJobs.status, 'completed'),
      eq(schema.researchJobs.resultMessageId, claimedResultMessageId),
    ))
}

function buildResearchAssistantParts(input: {
  result: ResearchFinalResult
  job: typeof schema.researchJobs.$inferSelect
  durationMs?: number
}): UIMessage['parts'] {
  const metadata: ResearchMetadata = {
    provider: input.job.provider,
    level: input.job.level,
    modelId: input.job.modelId,
    durationMs: input.durationMs,
    usage: input.result.usage,
  }

  const safeSources = input.result.sources.filter((source) => {
    return isHttpUrl(source.url)
  })

  return [
    { type: 'text', text: input.result.reportText },
    ...safeSources.map(source => ({
      type: 'source-url' as const,
      sourceId: source.sourceId,
      url: source.url,
      title: source.title,
    })),
    { type: 'data-research' as const, data: metadata },
    ...(input.result.trace?.length
      ? [{
        type: 'data-research-trace' as const,
        data: { entries: input.result.trace },
      }]
      : []),
  ] as UIMessage['parts']
}

// ResearchUsage only carries flat token totals (no provider token-detail
// breakdown), so this fills in the shape buildMessageUsage() expects from a
// normal streamText() usage object. Returns all-undefined when the job never
// captured usage — buildMessageUsage() treats that as incomplete and omits
// usage entirely, the same as an aborted normal-chat generation.
function toLanguageModelUsage(usage?: ResearchUsage): LanguageModelUsage {
  return {
    inputTokens: usage?.inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: usage?.outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: usage?.totalTokens,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)

    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (exception) {
    void exception

    return false
  }
}

function buildStartIncompleteError(): ChatErrorPayload {
  return normalizeChatError({
    error: new Error('Research job has no provider job id'),
    code: 'research-start-failed',
    message: 'The research job never started with the provider.',
  })
}

function buildKeyMissingError(
  providerId: ResearchProviderId,
): ChatErrorPayload {
  return normalizeChatError({
    error: new Error('Research API key not found'),
    code: 'provider-auth',
    providerId,
    message: 'The saved API key for this provider could not be found.',
  })
}

function buildTimeoutError(): ChatErrorPayload {
  return normalizeChatError({
    error: new Error('Research run exceeded the maximum allowed time'),
    code: 'research-timeout',
  })
}

function buildProviderJobGoneError(
  providerId: ResearchProviderId,
): ChatErrorPayload {
  return normalizeChatError({
    error: new Error('The research job no longer exists at the provider'),
    code: 'provider-unavailable',
    providerId,
    why: 'The research provider could not find this job anymore.',
  })
}

function buildProviderCancelledError(): ChatErrorPayload {
  return normalizeChatError({
    error: new Error('The research job was cancelled by the provider'),
    code: 'research-cancelled',
  })
}

function buildProviderFailureError(
  providerId: ResearchProviderId,
  raw: unknown,
): ChatErrorPayload {
  const reason = extractProviderFailureReason(providerId, raw)

  return normalizeChatError({
    error: new Error(
      reason || 'The research provider did not complete the run.',
    ),
    code: 'provider-unavailable',
    providerId,
    why: reason,
  })
}

function extractProviderFailureReason(
  providerId: ResearchProviderId,
  raw: unknown,
): string | undefined {
  if (providerId !== 'openai' || !raw || typeof raw !== 'object') {
    return undefined
  }

  const details = (raw as Record<string, unknown>).incomplete_details

  if (!details || typeof details !== 'object') {
    return undefined
  }

  const reason = (details as Record<string, unknown>).reason

  return typeof reason === 'string' ? reason : undefined
}
