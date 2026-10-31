import { eq } from 'drizzle-orm'
import type { Tools } from '#shared/types/chats.d'
import type {
  AutoWebSearchOutcome,
  WebSearchMode,
} from '#shared/utils/auto-web-search'
import {
  JEV_AUTO_WEB_SEARCH,
  JEV_AUTO_WEB_SEARCH_FACTUAL,
  JEV_AUTO_WEB_SEARCH_PRACTICAL,
  JEV_AUTO_WEB_SEARCH_SPECIFIC_WORK,
  JEV_EXPLICIT_SEARCH_PHRASES,
  JEV_GAME_GUIDE_PHRASES,
  JEV_RECENCY_PHRASES,
  JEV_SOURCES_PHRASES,
  JEV_URL_OR_DOMAIN_PATTERN,
  matchesJevPhrases,
} from '#shared/utils/jev-policy'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import * as schema from '~~/server/db/schema'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import type { JevDecideResult, JevQuestions } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleApiKey } from '~~/server/utils/jev/roles'
import {
  buildSendPathJevState,
  decideSendPathJev,
} from '~~/server/utils/jev/send-path'
import type { SendPathTurn } from '~~/server/utils/jev/send-path'

type DbClient = ReturnType<typeof useDb>

const AUTO_WEB_SEARCH_ROLE = 'autoWebSearch'
const QUESTION_COUNT = 4

const AUTO_WEB_SEARCH_POLICIES = [
  JEV_AUTO_WEB_SEARCH,
  JEV_AUTO_WEB_SEARCH_SPECIFIC_WORK,
  JEV_AUTO_WEB_SEARCH_PRACTICAL,
  JEV_AUTO_WEB_SEARCH_FACTUAL,
] as const

export interface AutoWebSearchResolution {
  tools: Tools
  outcome: AutoWebSearchOutcome | null
}

export interface AutoWebSearchAnswer {
  outcome: Exclude<AutoWebSearchOutcome, 'forced'>
  score: number | null
  scores: number[]
}

export interface ResolveAutoWebSearchInput {
  db: DbClient
  userId: number
  mode: WebSearchMode
  chosenTools: Tools
  defaultTools: Tools
  persistedTools: Tools | null
  messageText: string
  recentTurns: readonly SendPathTurn[]
  logger?: JevLogger
}

export function hasWebSearchTool(tools: Tools): boolean {
  return tools.some(isWebSearchTool)
}

export function withoutWebSearchTools(tools: Tools): Tools {
  return tools.filter((tool) => {
    return !isWebSearchTool(tool)
  })
}

/**
 * A URL or domain, a recency phrase, an explicit request to search the web,
 * a phrase that marks game help, or a request for sources makes a search
 * certain: such a message is searched without asking Jev.
 */
export function shouldForceAutoWebSearch(messageText: string): boolean {
  return JEV_URL_OR_DOMAIN_PATTERN.test(messageText)
    || matchesJevPhrases(messageText, JEV_RECENCY_PHRASES)
    || matchesJevPhrases(messageText, JEV_EXPLICIT_SEARCH_PHRASES)
    || matchesJevPhrases(messageText, JEV_GAME_GUIDE_PHRASES)
    || matchesJevPhrases(messageText, JEV_SOURCES_PHRASES)
}

export function autoWebSearchJevQuestions(): JevQuestions {
  return Object.fromEntries(
    AUTO_WEB_SEARCH_POLICIES.map((policy) => {
      return [policy.questionId, policy.question]
    }),
  )
}

/**
 * Reads the Auto web search answer from a send-path Jev result, which may
 * carry other roles' answers too. A failed call or a missing answer is a
 * `fallback`, which searches.
 */
export function readAutoWebSearchAnswer(
  result: JevDecideResult,
): AutoWebSearchAnswer {
  if (!result.ok) {
    return { outcome: 'fallback', score: null, scores: [] }
  }

  const scores: number[] = []
  let needsSearch = false

  for (const policy of AUTO_WEB_SEARCH_POLICIES) {
    const score = result.probabilities[policy.questionId]

    if (typeof score !== 'number') {
      return { outcome: 'fallback', score: null, scores: [] }
    }

    scores.push(score)
    needsSearch = needsSearch || score >= policy.searchAtOrAbove
  }

  return {
    outcome: needsSearch ? 'searched' : 'skipped',
    score: Math.max(...scores),
    scores,
  }
}

export function applyAutoWebSearchOutcome(
  tools: Tools,
  outcome: AutoWebSearchOutcome,
): Tools {
  return outcome === 'skipped' ? withoutWebSearchTools(tools) : tools
}

function reusedOutcome(persistedTools: Tools): AutoWebSearchOutcome {
  return hasWebSearchTool(persistedTools) ? 'searched' : 'skipped'
}

/**
 * Resolves the web-search tools for one user message in the Auto mode.
 *
 * Auto applies only when the client asks for it and the user has a
 * TypeSafe AI key with the `autoWebSearch` role on; otherwise
 * `defaultTools` come back unchanged, as without the key. A message already
 * persisted under the same id (a retry, or a new chat's first message its
 * first POST already resolved) reuses its persisted tools, so the decision
 * is made once per message id; this holds even when the client sent no
 * tools while its model capability was still loading. The PUT that creates
 * a chat never asks Jev: the first POST passes the PUT's tools as both the
 * chosen and the default tools, with `persistedTools: null` until decided.
 * A new message needs a chosen web-search provider. Otherwise a URL, a
 * domain or a recency phrase forces a search, then one Jev call decides,
 * and any Jev failure searches. Only a `skipped` outcome removes the
 * web-search tools.
 */
export async function resolveAutoWebSearch(
  input: ResolveAutoWebSearchInput,
): Promise<AutoWebSearchResolution> {
  const unchanged: AutoWebSearchResolution = {
    tools: input.defaultTools,
    outcome: null,
  }

  if (input.mode !== 'auto') {
    return unchanged
  }

  if (!input.persistedTools && !hasWebSearchTool(input.chosenTools)) {
    return unchanged
  }

  const apiKey = await resolveJevRoleApiKey({
    db: input.db,
    userId: input.userId,
    role: AUTO_WEB_SEARCH_ROLE,
    logger: input.logger,
  })

  if (!apiKey) {
    return unchanged
  }

  if (input.persistedTools) {
    const outcome = reusedOutcome(input.persistedTools)

    recordJevRoleLog(AUTO_WEB_SEARCH_ROLE, {
      status: 'ok',
      counts: { reused: 1, [outcome]: 1 },
    }, input.logger)

    return { tools: input.persistedTools, outcome }
  }

  if (!hasWebSearchTool(input.defaultTools)) {
    return unchanged
  }

  if (shouldForceAutoWebSearch(input.messageText)) {
    recordJevRoleLog(AUTO_WEB_SEARCH_ROLE, {
      status: 'ok',
      counts: { forced: 1 },
    }, input.logger)

    return { tools: input.defaultTools, outcome: 'forced' }
  }

  const model = createJevDecisionModel(apiKey)

  if (!model) {
    return unchanged
  }

  const result = await decideSendPathJev({
    model,
    state: buildSendPathJevState({
      messageText: input.messageText,
      recentTurns: input.recentTurns.slice(-JEV_AUTO_WEB_SEARCH.recentTurns),
    }),
    questions: autoWebSearchJevQuestions(),
  })
  const answer = readAutoWebSearchAnswer(result)

  recordJevRoleLog(AUTO_WEB_SEARCH_ROLE, {
    status: result.status,
    calls: 1,
    questions: QUESTION_COUNT,
    inputTokens: result.ok ? result.inputTokens ?? undefined : undefined,
    latencyMs: result.latencyMs,
    counts: { [answer.outcome]: 1 },
    scores: answer.scores.length === 0 ? undefined : answer.scores,
  }, input.logger)

  return {
    tools: applyAutoWebSearchOutcome(input.defaultTools, answer.outcome),
    outcome: answer.outcome,
  }
}

export interface FirstMessageAutoWebSearchKey {
  chatId: string
  messageId: string
}

interface AutoWebSearchDecisionStore {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
}

const FIRST_MESSAGE_DECISION_KEY_PREFIX = 'auto-web-search-first-message'
const FIRST_MESSAGE_DECISION_TTL_SECONDS = 24 * 60 * 60

function toDecisionStoreKey(key: FirstMessageAutoWebSearchKey): string {
  return `${FIRST_MESSAGE_DECISION_KEY_PREFIX}:${key.chatId}:${key.messageId}`
}

function hasSameTools(left: Tools, right: Tools): boolean {
  return left.length === right.length
    && left.every((tool, index) => tool === right[index])
}

/**
 * The tools the Auto mode may pick from for one send: the default tools,
 * plus the persisted tools a retry would reuse. The send path validates
 * this superset (gateway allowance, model support, search keys, transfer
 * consent) before Jev is asked, since Auto only ever removes web-search
 * tools or reuses persisted ones.
 */
export function collectAutoWebSearchCandidateTools(input: {
  mode: WebSearchMode
  defaultTools: Tools
  persistedTools: Tools | null
}): Tools {
  if (input.mode !== 'auto' || !input.persistedTools) {
    return input.defaultTools
  }

  return [...new Set([...input.defaultTools, ...input.persistedTools])]
}

/**
 * Whether a chat POST already decided Auto for a new chat's first message,
 * so a retry of that message reuses the decision. A KV failure reads as
 * undecided, which only costs one more Jev call.
 */
export async function hasFirstMessageAutoWebSearchDecision(
  store: AutoWebSearchDecisionStore,
  key: FirstMessageAutoWebSearchKey,
): Promise<boolean> {
  try {
    return await store.get(toDecisionStoreKey(key)) !== null
  } catch {
    return false
  }
}

/**
 * Stores the Auto decision for a new chat's first message: the resolved
 * tools go onto the persisted user row, as for any other message, then a
 * KV marker (`auto-web-search-first-message:<chat>:<message>`, one day)
 * says the row is decided. Nothing is written when Auto did not apply, and
 * a failed KV write only means a retry asks Jev again.
 */
export async function recordFirstMessageAutoWebSearchDecision(input: {
  db: DbClient
  kv: AutoWebSearchDecisionStore
  key: FirstMessageAutoWebSearchKey
  messageRowId: string
  persistedTools: Tools
  resolution: AutoWebSearchResolution
}): Promise<void> {
  if (!input.resolution.outcome) {
    return
  }

  if (!hasSameTools(input.persistedTools, input.resolution.tools)) {
    await input.db.update(schema.messages)
      .set({ tools: input.resolution.tools })
      .where(eq(schema.messages.id, input.messageRowId))
  }

  await writeDecisionMarker(input.kv, input.key, input.resolution.outcome)
}

async function writeDecisionMarker(
  store: AutoWebSearchDecisionStore,
  key: FirstMessageAutoWebSearchKey,
  outcome: AutoWebSearchOutcome,
): Promise<boolean> {
  try {
    await store.put(toDecisionStoreKey(key), outcome, {
      expirationTtl: FIRST_MESSAGE_DECISION_TTL_SECONDS,
    })

    return true
  } catch {
    return false
  }
}
