import { APICallError, experimental_decide } from 'ai'
import type {
  Experimental_DecisionModel,
  Experimental_DecisionQuestion,
  Experimental_DecisionState,
} from 'ai'
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai'
import { JEV_MODEL_ID } from '#shared/utils/jev-policy'
import { useDecryptText } from '~~/server/utils/encryption'

type DbClient = ReturnType<typeof useDb>

export const JEV_KEY_PROVIDER = 'typesafe'

export type JevFailureStatus
  = | 'unauthorized'
    | 'rate-limited'
    | 'timeout'
    | 'network'
    | 'error'

export type JevStatus = 'ok' | 'key-error' | JevFailureStatus

export type JevQuestions = Record<string, Experimental_DecisionQuestion>

export type JevProbabilities = Record<string, number>

export type JevDecideResult
  = | {
    ok: true
    status: 'ok'
    probabilities: JevProbabilities
    inputTokens: number | null
    latencyMs: number
  }
  | {
    ok: false
    status: JevFailureStatus
    latencyMs: number
  }

export interface JevDecideInput {
  model: Experimental_DecisionModel
  state: Experimental_DecisionState
  questions: JevQuestions
  timeoutMs: number
  abortSignal?: AbortSignal
}

const MAX_RETRIES = 0
const UNAUTHORIZED_STATUSES = new Set([401, 403])
const RATE_LIMITED_STATUSES = new Set([429, 529])
const TIMEOUT_ERROR_NAMES = new Set(['TimeoutError', 'AbortError'])

function readErrorStatus(exception: unknown): number | undefined {
  if (APICallError.isInstance(exception)) {
    return exception.statusCode
  }

  const lastError = (exception as { lastError?: unknown } | null)?.lastError

  if (lastError && APICallError.isInstance(lastError)) {
    return lastError.statusCode
  }

  return undefined
}

function isTimeoutError(exception: unknown): boolean {
  let current: unknown = exception

  while (current instanceof Error) {
    if (TIMEOUT_ERROR_NAMES.has(current.name)) {
      return true
    }

    current = current.cause
  }

  return false
}

/**
 * Maps a failed Jev call to a status. Every status means Jev was unavailable
 * and the caller falls back to its behaviour without a TypeSafe AI key. A
 * refusal answer (`Experimental_DecisionRefusalError`) is `error`.
 */
export function classifyJevFailure(exception: unknown): JevFailureStatus {
  const status = readErrorStatus(exception)

  if (status !== undefined && UNAUTHORIZED_STATUSES.has(status)) {
    return 'unauthorized'
  }

  if (status !== undefined && RATE_LIMITED_STATUSES.has(status)) {
    return 'rate-limited'
  }

  if (isTimeoutError(exception)) {
    return 'timeout'
  }

  if (status !== undefined) {
    return 'error'
  }

  if (APICallError.isInstance(exception) || exception instanceof TypeError) {
    return 'network'
  }

  return 'error'
}

/**
 * Builds the pinned Jev decision model for a decrypted key, or `null` for an
 * empty key so the SDK never falls back to the `TYPESAFE_AI_API_KEY` env var.
 */
export function createJevDecisionModel(
  apiKey: string,
): Experimental_DecisionModel | null {
  const trimmed = apiKey.trim()

  if (!trimmed) {
    return null
  }

  return createTypeSafeAi({ apiKey: trimmed }).decisionModel(JEV_MODEL_ID)
}

/**
 * Reads and decrypts the user's saved TypeSafe AI key: one D1 read and one
 * decrypt. Returns `null` without a key; a failing read or decryption throws
 * so the caller can log it as `key-error`.
 */
export async function readJevApiKey(input: {
  db: DbClient
  userId: number
}): Promise<string | null> {
  const row = await input.db.query.keys.findFirst({
    where: { userId: input.userId, provider: JEV_KEY_PROVIDER },
    columns: { apiKey: true },
  })

  if (!row?.apiKey) {
    return null
  }

  return useDecryptText(row.apiKey)
}

function readProbabilities(
  answers: Record<string, unknown>,
): JevProbabilities {
  const probabilities: JevProbabilities = {}

  for (const [id, answer] of Object.entries(answers)) {
    const probability = (answer as { probability?: unknown } | undefined)
      ?.probability

    if (typeof probability === 'number') {
      probabilities[id] = probability
    }
  }

  return probabilities
}

function combineSignals(
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)

  return abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal
}

/**
 * One Jev call through the AI SDK's `experimental_decide`, with no retries,
 * a hard `timeoutMs` and an optional caller abort. It never throws: a failure
 * comes back as `{ ok: false, status }` from `classifyJevFailure`, so every
 * role can fall back in its own safe direction. Boolean answers are returned
 * as probabilities keyed by question id.
 */
export async function jevDecide(
  input: JevDecideInput,
): Promise<JevDecideResult> {
  const startedAt = Date.now()

  try {
    const result = await experimental_decide({
      model: input.model,
      state: input.state,
      questions: input.questions,
      maxRetries: MAX_RETRIES,
      abortSignal: combineSignals(input.timeoutMs, input.abortSignal),
    })

    return {
      ok: true,
      status: 'ok',
      probabilities: readProbabilities(
        result.answers as Record<string, unknown>,
      ),
      inputTokens: result.usage?.inputTokens ?? null,
      latencyMs: Date.now() - startedAt,
    }
  } catch (exception) {
    return {
      ok: false,
      status: classifyJevFailure(exception),
      latencyMs: Date.now() - startedAt,
    }
  }
}
