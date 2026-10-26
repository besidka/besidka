import { JEV_EXTRACTION_PREFILTER } from '#shared/utils/jev-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevStatus } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import { memoryExtractionChunkRanges } from '~~/server/utils/memory/extract-input'

type DbClient = ReturnType<typeof useDb>

const ROLE = 'extractionPrefilter'
const SCORE_BUCKETS_PER_UNIT = 10

export type MemoryExtractionPrefilterVerdict
  = | { action: 'skip', maxScore: number }
    | { action: 'extract', maxScore: number | null }

/**
 * Splits a transcript into pieces of at most `maxChunkTokens` estimated
 * tokens. A piece that is still over the limit (the Latin/Cyrillic mix of
 * one part can differ from the whole) is split again, so the loop ends: each
 * split limit is below the length of the text being split.
 */
export function splitMemoryExtractionTranscript(
  transcript: string,
  maxChunkTokens: number,
): string[] {
  const tokens = estimateMemoryTokens(transcript)

  if (tokens <= maxChunkTokens) {
    return [transcript]
  }

  const maxChars = Math.floor(maxChunkTokens * transcript.length / tokens)

  return memoryExtractionChunkRanges(transcript, maxChars).flatMap((range) => {
    return splitMemoryExtractionTranscript(
      transcript.slice(range.start, range.end),
      maxChunkTokens,
    )
  })
}

function scoreBucket(score: number): string {
  return (Math.floor(score * SCORE_BUCKETS_PER_UNIT) / SCORE_BUCKETS_PER_UNIT)
    .toFixed(1)
}

/**
 * Asks TypeSafe AI Jev whether a never-store-redacted transcript holds
 * anything durable about the user, so the model extraction can be skipped for
 * pure task chats. A long transcript is scored in chunks of at most
 * `JEV_EXTRACTION_PREFILTER.maxChunkTokens` and skips only when every chunk
 * scores below `skipBelow`; the first chunk at or above it ends the check.
 * Without a key, with the role off, or on any failure (including a missing
 * answer) it returns `extract`, which is exactly what runs without the role.
 */
export async function memoryExtractionPrefilter(input: {
  db: DbClient
  userId: number
  transcript: string
  logger?: JevLogger
}): Promise<MemoryExtractionPrefilterVerdict> {
  const policy = JEV_EXTRACTION_PREFILTER
  const model = await resolveJevRoleModel({
    db: input.db,
    userId: input.userId,
    role: ROLE,
    logger: input.logger,
  })

  if (!model) {
    return { action: 'extract', maxScore: null }
  }

  const chunks = splitMemoryExtractionTranscript(
    input.transcript,
    policy.maxChunkTokens,
  )
  const scores: number[] = []
  let calls = 0
  let inputTokens = 0
  let latencyMs = 0
  let failure: JevStatus | null = null

  for (const chunk of chunks) {
    const decision = await jevDecide({
      model,
      state: { transcript: chunk },
      questions: { [policy.questionId]: policy.question },
      timeoutMs: policy.timeoutMs,
    })

    calls += 1
    latencyMs += decision.latencyMs

    if (!decision.ok) {
      failure = decision.status

      break
    }

    inputTokens += decision.inputTokens ?? 0

    const score = decision.probabilities[policy.questionId]

    if (score === undefined) {
      failure = 'error'

      break
    }

    scores.push(score)

    if (score >= policy.skipBelow) {
      break
    }
  }

  const maxScore = scores.length ? Math.max(...scores) : null
  const isSkip = failure === null
    && scores.length === chunks.length
    && maxScore !== null
    && maxScore < policy.skipBelow

  recordJevRoleLog(ROLE, {
    status: failure ?? 'ok',
    calls,
    questions: calls,
    inputTokens,
    latencyMs,
    scores,
    ...(isSkip ? { counts: { skipped: 1 } } : {}),
  }, input.logger)

  if (isSkip) {
    return { action: 'skip', maxScore }
  }

  return { action: 'extract', maxScore: failure ? null : maxScore }
}

/**
 * Logs how many entries the model produced for a chat the pre-filter let
 * through, bucketed by the chat's highest chunk score (for example
 * `entriesAtScore0.4`), so `skipBelow` can be re-tuned from real traffic:
 * extracted chats that produce nothing in the lowest buckets mean the
 * threshold could be higher. Counts and scores only, never text.
 */
export function recordMemoryExtractionPrefilterOutcome(input: {
  maxScore: number | null
  entriesProposed: number
  entriesApplied: number
  logger?: JevLogger
}): void {
  if (input.maxScore === null) {
    return
  }

  const bucket = scoreBucket(input.maxScore)

  recordJevRoleLog(ROLE, {
    status: 'ok',
    counts: {
      [`chatsAtScore${bucket}`]: 1,
      [`proposedAtScore${bucket}`]: input.entriesProposed,
      [`entriesAtScore${bucket}`]: input.entriesApplied,
    },
  }, input.logger)
}
