import { createError } from 'evlog'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import { CHAT_SEARCH_MAX_CALLS_PER_TURN } from '~~/server/utils/memory/tools/constants'

export const CHAT_SEARCH_LIMIT_MESSAGE = 'Lookup limit for this message '
  + 'reached (chat history and memory tools); answer from the results already '
  + 'gathered.'

export interface ChatSearchBudget {
  maxCalls: number
  usedCalls: number
  untrustedResultSeen: boolean
}

/**
 * One budget is created per chat request and shared by `search_chats`,
 * `read_chat` and the memory tools, so a single model step that fans out
 * parallel calls cannot multiply the D1 reads. `untrustedResultSeen` is set
 * by the tool loop once a step returned a result from any non-memory tool
 * (web search, files, other chats) and locks `memory_write` and
 * `memory_forget` for the rest of the request. The chat route also presets
 * it up front when the send requests any web search (native provider search,
 * gateway search or Brave/Exa, keyed off the requested tools, because native
 * search can run inside the same step as a write or return no tool part at
 * all), and when project knowledge puts document text (full mode) or media
 * into the prompt (see `holdsUntrustedKnowledge` in
 * `server/utils/knowledge/context.ts`). Create it
 * per request, never at module scope: a module-level counter would leak across
 * requests on a reused Worker isolate.
 */
export function createChatSearchBudget(
  maxCalls: number = CHAT_SEARCH_MAX_CALLS_PER_TURN,
): ChatSearchBudget {
  return { maxCalls, usedCalls: 0, untrustedResultSeen: false }
}

/**
 * Spends one call from the budget, or throws before any database access.
 * The throw inside a tool `execute()` becomes a `tool-error` part, not a
 * stream failure, so the model reads `message` and answers from the results
 * it already has.
 */
export function consumeChatSearchCall(budget: ChatSearchBudget) {
  if (budget.usedCalls >= budget.maxCalls) {
    throw createError({
      message: CHAT_SEARCH_LIMIT_MESSAGE,
      status: 429,
      why: `This message already used ${budget.maxCalls} lookup calls.`,
      fix: 'Answer from the results already gathered.',
    })
  }

  budget.usedCalls += 1
}

/**
 * Locks `memory_write` and `memory_forget` before the first model step when
 * the send itself brings untrusted content: any requested web search (keyed
 * off the send's tools, never off which tool definitions got registered,
 * because native provider and gateway search can run inside the same step as
 * a write or return no tool part at all), project knowledge already in the
 * prompt, or past-chat excerpts pre-retrieved into the last user turn. The
 * read tools stay available.
 */
export function presetMemoryWriteLock(
  budget: ChatSearchBudget,
  send: {
    requestedTools: readonly unknown[]
    holdsUntrustedKnowledge: boolean
    holdsPastChatExcerpts?: boolean
  },
): void {
  const requestsWebSearch = send.requestedTools.some(isWebSearchTool)

  if (
    requestsWebSearch
    || send.holdsUntrustedKnowledge
    || send.holdsPastChatExcerpts === true
  ) {
    budget.untrustedResultSeen = true
  }
}
