import type { Tools } from '#shared/types/chats.d'
import type {
  AutoWebSearchOutcome,
  WebSearchMode,
} from '#shared/utils/auto-web-search'
import {
  JEV_AUTO_WEB_SEARCH,
  JEV_RECENCY_PHRASES,
  JEV_URL_OR_DOMAIN_PATTERN,
  matchesJevPhrases,
} from '#shared/utils/jev-policy'
import { isWebSearchTool } from '#shared/utils/message-metadata'
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
const QUESTION_COUNT = 1

export interface AutoWebSearchResolution {
  tools: Tools
  outcome: AutoWebSearchOutcome | null
}

export interface AutoWebSearchAnswer {
  outcome: Exclude<AutoWebSearchOutcome, 'forced'>
  score: number | null
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
 * A URL or domain, or a recency phrase, makes a search certain: such a
 * message is searched without asking Jev.
 */
export function shouldForceAutoWebSearch(messageText: string): boolean {
  return JEV_URL_OR_DOMAIN_PATTERN.test(messageText)
    || matchesJevPhrases(messageText, JEV_RECENCY_PHRASES)
}

export function autoWebSearchJevQuestions(): JevQuestions {
  return {
    [JEV_AUTO_WEB_SEARCH.questionId]: JEV_AUTO_WEB_SEARCH.question,
  }
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
    return { outcome: 'fallback', score: null }
  }

  const score = result.probabilities[JEV_AUTO_WEB_SEARCH.questionId]

  if (typeof score !== 'number') {
    return { outcome: 'fallback', score: null }
  }

  return {
    outcome: score >= JEV_AUTO_WEB_SEARCH.searchAtOrAbove
      ? 'searched'
      : 'skipped',
    score,
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
 * Auto applies only when the client asks for it with a web-search provider
 * chosen, and the user has a TypeSafe AI key with the `autoWebSearch` role
 * on; otherwise `defaultTools` come back unchanged, as without the key. A
 * message already persisted under the same id (a retry, or a new chat's
 * first message the PUT already resolved) reuses its persisted tools, so the
 * decision is made once per message id. Otherwise a URL, a domain or a
 * recency phrase forces a search, then one Jev call decides, and any Jev
 * failure searches. Only a `skipped` outcome removes the web-search tools.
 */
export async function resolveAutoWebSearch(
  input: ResolveAutoWebSearchInput,
): Promise<AutoWebSearchResolution> {
  const unchanged: AutoWebSearchResolution = {
    tools: input.defaultTools,
    outcome: null,
  }

  if (input.mode !== 'auto' || !hasWebSearchTool(input.chosenTools)) {
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
    scores: answer.score === null ? undefined : [answer.score],
  }, input.logger)

  return {
    tools: applyAutoWebSearchOutcome(input.defaultTools, answer.outcome),
    outcome: answer.outcome,
  }
}
