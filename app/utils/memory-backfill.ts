import { parseError } from 'evlog'
import type {
  MemoryBackfillFailureReason,
  MemoryBackfillProgress,
  MemoryBackfillUnavailableReason,
} from '#shared/types/memory-backfill.d'
import type { MemoryModelSource } from '#shared/types/memory.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'

export const MEMORY_BACKFILL_COOLDOWN_MS = 10_000

const TINY_COST_THRESHOLD_USD = 0.01

const TOKENS_PER_MILLION = 1_000_000

const BACKFILL_MAX_MILLION_TOKENS
  = MEMORY_LIMITS.backfillMaxTokens / TOKENS_PER_MILLION

const BACKFILL_TOKEN_LIMIT_SENTENCE = 'Stops after '
  + `${BACKFILL_MAX_MILLION_TOKENS} million tokens in total, even if the `
  + 'cost could not be estimated.'

export function describeBackfillLimits(isContinuation: boolean): string {
  const chatLimit = MEMORY_LIMITS.backfillMaxChats

  if (isContinuation) {
    return 'Continues where the last run stopped and reads at most the next '
      + `${chatLimit} older account chats. ${BACKFILL_TOKEN_LIMIT_SENTENCE}`
  }

  return `Reads at most your ${chatLimit} most recent account chats. `
    + BACKFILL_TOKEN_LIMIT_SENTENCE
}

export const BACKFILL_RESTART_NOTE = 'Starts over from your newest chat '
  + 'and reads chats that earlier runs already read, so your API key is '
  + 'charged for them again.'

export function describeBackfillChats(
  chats: number,
  isContinuation: boolean,
): string {
  const noun = chats === 1 ? 'chat' : 'chats'

  return isContinuation
    ? `next ${chats} older ${noun}`
    : `${chats} ${noun}`
}

export const memoryBackfillModelSourceLabels: Record<
  MemoryModelSource,
  string
> = {
  setting: 'your chosen memory model',
  chat: 'same as chat',
  fallback: 'fallback',
}

export const memoryBackfillFailureLabels: Record<
  MemoryBackfillFailureReason,
  string
> = {
  'model-unavailable': 'The model became unavailable.',
  'spend-limit': 'Stopped at the spend limit: 1.5 times the estimate or '
    + `${BACKFILL_MAX_MILLION_TOKENS} million tokens.`,
  'too-many-failures': 'Too many chats failed.',
  'consecutive-failures': 'Several chats in a row failed.',
}

export const memoryBackfillUnavailableCopy: Record<
  Exclude<MemoryBackfillUnavailableReason, 'no-model'>,
  string
> = {
  'memory-disabled': 'Turn on Use memory first.',
  'extraction-disabled': 'Turn on Generate memory from chats first.',
  'estimate-failed': 'Couldn\'t estimate the cost. Try again.',
  'estimate-cooldown': 'The cost was estimated moments ago. Try again in '
    + 'half a minute.',
  'all-chats-read': 'The last run already read all your past chats. New '
    + 'chats are added to memory automatically. You can still read them all '
    + 'again from the newest.',
}

export const memoryBackfillDroppedLabels: Record<string, string> = {
  'sensitive-topic': 'Sensitive topics (never saved)',
  'never-store': 'Private data (never saved)',
  'duplicate': 'Already remembered',
  'ungrounded': 'No supporting quote',
  'extra-check-sensitive': 'Sensitive data found by the TypeSafe AI check',
  'extra-check-ungrounded': 'Not backed by the text, per the TypeSafe AI check',
  'chat-unavailable': 'Chat deleted while it was read',
}

export function describeBackfillDroppedReason(reason: string): string {
  return memoryBackfillDroppedLabels[reason] ?? reason
}

export function formatBackfillCost(costUsd: number | null): string {
  if (costUsd === null) {
    return 'price unknown'
  }

  if (costUsd > 0 && costUsd < TINY_COST_THRESHOLD_USD) {
    return '< $0.01'
  }

  return `$${costUsd.toFixed(2)}`
}

export function isBackfillJobFinished(
  job: MemoryBackfillProgress | null,
): boolean {
  return !!job && job.status !== 'running'
}

export function countBackfillEntries(
  job: MemoryBackfillProgress | null,
): number {
  if (!job) {
    return 0
  }

  return job.createdEntries + job.updatedEntries
}

export interface MemoryBackfillErrorMessage {
  message: string
  why: string | undefined
  status: number
}

function readRetryAfterHeaderMs(exception: unknown): number | null {
  const response = (exception as {
    response?: { headers?: { get?: (name: string) => string | null } }
  } | null)?.response
  const header = response?.headers?.get?.('retry-after')
  const seconds = Number(header)

  if (!header || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return seconds * 1000
}

export function getBackfillRetryAfterMs(exception: unknown): number {
  const headerMs = readRetryAfterHeaderMs(exception)

  if (headerMs !== null) {
    return headerMs
  }

  const retryAfter = parseError(exception).data?.retryAfter

  if (typeof retryAfter === 'number' && retryAfter > 0) {
    return retryAfter * 1000
  }

  return MEMORY_BACKFILL_COOLDOWN_MS
}

export function describeBackfillError(
  exception: unknown,
  fallbackMessage: string,
): MemoryBackfillErrorMessage {
  const parsedException = parseError(exception)

  if (parsedException.status === 429) {
    return {
      message: 'Please wait a moment',
      why: 'Try again in a few seconds.',
      status: 429,
    }
  }

  return {
    message: parsedException.message || fallbackMessage,
    why: parsedException.why,
    status: parsedException.status,
  }
}
