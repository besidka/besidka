import { parseError } from 'evlog'
import type {
  MemoryBackfillFailureReason,
  MemoryBackfillProgress,
  MemoryBackfillUnavailableReason,
} from '#shared/types/memory-backfill.d'
import type { MemoryModelSource } from '#shared/types/memory.d'

export const MEMORY_BACKFILL_COOLDOWN_MS = 10_000

const TINY_COST_THRESHOLD_USD = 0.01

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
  'spend-limit': 'Stopped: spend would exceed the estimate.',
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
}

export const memoryBackfillDroppedLabels: Record<string, string> = {
  'sensitive-topic': 'Sensitive topics (never saved)',
  'never-store': 'Private data (never saved)',
  'duplicate': 'Already remembered',
  'ungrounded': 'No supporting quote',
}

export function describeBackfillDroppedReason(reason: string): string {
  return memoryBackfillDroppedLabels[reason] ?? reason
}

export function formatBackfillCost(costUsd: number | null): string {
  if (costUsd === null) {
    return 'price unknown'
  }

  if (costUsd < TINY_COST_THRESHOLD_USD) {
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
