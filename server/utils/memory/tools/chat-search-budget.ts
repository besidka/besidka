import { createError } from 'evlog'
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
 * it when project knowledge puts document text (full mode) or media into the
 * prompt, so those sends refuse memory writes too (see
 * `holdsUntrustedKnowledge` in `server/utils/knowledge/context.ts`). Create it
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
