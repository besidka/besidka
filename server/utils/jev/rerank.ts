import type { Experimental_DecisionModel } from 'ai'
import { JEV_RERANK } from '#shared/utils/jev-policy'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevQuestions } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import { redactNeverStore } from '~~/server/utils/memory/compliance'
import { truncateToTokens } from '~~/server/utils/knowledge/search'

type DbClient = ReturnType<typeof useDb>

export type JevRerankModelResolver
  = () => Promise<Experimental_DecisionModel | null>

export interface JevRerankInput<Candidate> {
  model: Experimental_DecisionModel | null | undefined
  query: string
  candidates: Candidate[]
  passageOf: (candidate: Candidate) => string
  keepAtLeast: number
  logger?: JevLogger
}

interface PreparedText {
  text: string
  redacted: number
}

function prepareText(text: string, maxTokens?: number): PreparedText {
  const redaction = redactNeverStore(text)

  return {
    text: maxTokens === undefined
      ? redaction.text
      : truncateToTokens(redaction.text, maxTokens),
    redacted: redaction.blockedTotal,
  }
}

function passageStateKey(index: number): string {
  return `${JEV_RERANK.passageStateKeyPrefix}${index}`
}

/**
 * The query and every passage go into the shared state, one top-level key
 * per passage (`passage_<i>`), and each question only names its passage by
 * that key. A passage is third-party text, so it never sits in a question's
 * instructions, where it could steer its own relevance score.
 */
function buildState(query: string, passages: string[]): Record<string, string> {
  const state: Record<string, string> = { query }

  passages.forEach((passage, index) => {
    state[passageStateKey(index)] = passage
  })

  return state
}

function buildQuestions(count: number): JevQuestions {
  const questions: JevQuestions = {}

  for (let index = 0; index < count; index++) {
    questions[`c${index}`] = {
      type: 'boolean',
      instructions: JEV_RERANK.task.replace(
        JEV_RERANK.passagePlaceholder,
        passageStateKey(index),
      ),
      criteria: JEV_RERANK.criteria,
    }
  }

  return questions
}

function readScores(
  probabilities: Record<string, number>,
  count: number,
): number[] | null {
  const scores: number[] = []

  for (let index = 0; index < count; index++) {
    const score = probabilities[`c${index}`]

    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return null
    }

    scores.push(score)
  }

  return scores
}

/**
 * Candidate positions by descending relevance, the original position
 * breaking ties. The cut at `JEV_RERANK.dropBelow` only applies when at
 * least `keepAtLeast` candidates stay above it, so the caller never gets
 * fewer results than the BM25 order would have given.
 */
export function orderByRelevance(
  scores: number[],
  keepAtLeast: number,
): { order: number[], dropped: number } {
  const sorted = scores
    .map((score, index) => ({ score, index }))
    .sort((first, second) => {
      return second.score - first.score || first.index - second.index
    })
  const above = sorted.filter((entry) => {
    return entry.score >= JEV_RERANK.dropBelow
  })
  const kept = above.length >= keepAtLeast ? above : sorted

  return {
    order: kept.map(entry => entry.index),
    dropped: sorted.length - kept.length,
  }
}

function countMovedPositions(order: number[], keepAtLeast: number): number {
  return order.slice(0, keepAtLeast).filter((originalIndex, position) => {
    return originalIndex !== position
  }).length
}

async function rerankCandidates<Candidate>(
  input: JevRerankInput<Candidate>,
  model: Experimental_DecisionModel,
): Promise<Candidate[]> {
  const judged = input.candidates.slice(0, JEV_RERANK.maxCandidates)
  const unjudged = input.candidates.slice(JEV_RERANK.maxCandidates)
  const query = prepareText(input.query, JEV_RERANK.maxPassageTokens)
  const passages = judged.map((candidate) => {
    return prepareText(
      input.passageOf(candidate),
      JEV_RERANK.maxPassageTokens,
    )
  })
  const redacted = passages.reduce((sum, passage) => {
    return sum + passage.redacted
  }, query.redacted)
  const result = await jevDecide({
    model,
    state: buildState(query.text, passages.map(passage => passage.text)),
    questions: buildQuestions(passages.length),
    timeoutMs: JEV_RERANK.timeoutMs,
  })

  if (!result.ok) {
    recordJevRoleLog('rerank', {
      status: result.status,
      calls: 1,
      questions: judged.length,
      latencyMs: result.latencyMs,
    }, input.logger)

    return input.candidates
  }

  const scores = readScores(result.probabilities, judged.length)

  if (!scores) {
    recordJevRoleLog('rerank', {
      status: 'error',
      calls: 1,
      questions: judged.length,
      inputTokens: result.inputTokens ?? undefined,
      latencyMs: result.latencyMs,
    }, input.logger)

    return input.candidates
  }

  const { order, dropped } = orderByRelevance(scores, input.keepAtLeast)
  const reordered = order.map(index => judged[index]!)

  recordJevRoleLog('rerank', {
    status: 'ok',
    calls: 1,
    questions: judged.length,
    inputTokens: result.inputTokens ?? undefined,
    latencyMs: result.latencyMs,
    counts: {
      candidates: judged.length,
      moved: countMovedPositions(order, input.keepAtLeast),
      dropped,
      redacted,
    },
    scores: [...scores].sort((first, second) => second - first),
  }, input.logger)

  return dropped > 0 ? reordered : [...reordered, ...unjudged]
}

/**
 * Re-ranks BM25 candidates with TypeSafe AI Jev: the query is the shared
 * state and every passage is the instructions of its own boolean question,
 * so no passage sees another. At most `JEV_RERANK.maxCandidates` candidates
 * are judged; the rest follow in their original order. Passages and the
 * query are never-store redacted before truncation to
 * `JEV_RERANK.maxPassageTokens`, so a cut can never leave half of a redacted
 * value and a pasted message cannot exceed the Jev input cap. Without a
 * model, with fewer than two candidates, or on any Jev failure or incomplete
 * answer, the candidates come back unchanged.
 */
export async function rerankWithJev<Candidate>(
  input: JevRerankInput<Candidate>,
): Promise<Candidate[]> {
  if (!input.model || input.candidates.length < 2) {
    return input.candidates
  }

  try {
    return await rerankCandidates(input, input.model)
  } catch {
    recordJevRoleLog('rerank', {
      status: 'error',
      calls: 1,
    }, input.logger)

    return input.candidates
  }
}

/**
 * A lazy, memoized resolver of the user's `rerank` Jev model: the key and
 * role settings are read on the first call only, so a send whose tools never
 * search costs nothing, and every later call in the request reuses the same
 * promise. It resolves to `null` without a key or with the role switched
 * off, and never rejects.
 */
export function createJevRerankModelResolver(input: {
  db: DbClient
  userId: number
  logger?: JevLogger
}): JevRerankModelResolver {
  let modelPromise: Promise<Experimental_DecisionModel | null> | null = null

  return () => {
    modelPromise ??= resolveJevRoleModel({
      db: input.db,
      userId: input.userId,
      role: 'rerank',
      logger: input.logger,
    }).catch(() => null)

    return modelPromise
  }
}
