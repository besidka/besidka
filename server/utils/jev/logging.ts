import { JEV_MODEL_ID } from '#shared/utils/jev-policy'
import type { JevRoleId } from '#shared/utils/jev-policy'
import type { JevStatus } from '~~/server/utils/jev/client'

export interface JevLogger {
  set: (fields: Record<string, unknown>) => void
  getContext?: () => Record<string, unknown>
}

export interface JevRoleLogFields {
  status: JevStatus
  calls?: number
  questions?: number
  inputTokens?: number
  latencyMs?: number
  counts?: Record<string, number>
  scores?: number[]
}

interface JevRoleLogRecord extends JevRoleLogFields {
  model: string
}

export const JEV_MAX_LOGGED_SCORES = 30

const SCORE_DECIMALS = 100

const MEMORY_CHECKS_LOG_KEY = 'memoryJev'

export function jevRoleLogKey(role: JevRoleId): string {
  return role === 'memoryChecks' ? MEMORY_CHECKS_LOG_KEY : `${role}Jev`
}

function sumOptional(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined
  }

  return (left ?? 0) + (right ?? 0)
}

function mergeCounts(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!left && !right) {
    return undefined
  }

  const merged = { ...left }

  for (const [key, count] of Object.entries(right ?? {})) {
    merged[key] = (merged[key] ?? 0) + count
  }

  return merged
}

function roundScore(score: number): number {
  return Math.round(score * SCORE_DECIMALS) / SCORE_DECIMALS
}

function mergeScores(
  left: number[] | undefined,
  right: number[] | undefined,
): number[] | undefined {
  if (!left && !right) {
    return undefined
  }

  return [...(left ?? []), ...(right ?? [])]
    .filter(score => Number.isFinite(score))
    .map(roundScore)
    .slice(0, JEV_MAX_LOGGED_SCORES)
}

function readPrevious(
  logKey: string,
  logger: JevLogger,
): JevRoleLogRecord | null {
  const context = logger.getContext?.() as {
    attributes?: Record<string, JevRoleLogRecord | undefined>
  } | undefined

  return context?.attributes?.[logKey] ?? null
}

function withoutUndefined(
  record: JevRoleLogRecord,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    return value !== undefined
  }))
}

/**
 * Logs one role's Jev outcome under `attributes.<role>Jev` (the memory check
 * keeps `attributes.memoryJev`). The fields are numbers and a status only, so
 * no state, question or answer text can reach the logs. Repeated calls in
 * one request add up through `logger.getContext()`; `status` is the last
 * call's and at most `JEV_MAX_LOGGED_SCORES` rounded scores are kept.
 */
export function recordJevRoleLog(
  role: JevRoleId,
  fields: JevRoleLogFields,
  logger: JevLogger | undefined,
): void {
  if (!logger) {
    return
  }

  const logKey = jevRoleLogKey(role)
  const previous = readPrevious(logKey, logger)
  const record: JevRoleLogRecord = {
    model: JEV_MODEL_ID,
    status: fields.status,
    calls: sumOptional(previous?.calls, fields.calls),
    questions: sumOptional(previous?.questions, fields.questions),
    inputTokens: sumOptional(previous?.inputTokens, fields.inputTokens),
    latencyMs: sumOptional(previous?.latencyMs, fields.latencyMs),
    counts: mergeCounts(previous?.counts, fields.counts),
    scores: mergeScores(previous?.scores, fields.scores),
  }

  logger.set({ attributes: { [logKey]: withoutUndefined(record) } })
}
