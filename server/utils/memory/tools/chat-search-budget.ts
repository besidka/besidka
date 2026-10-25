import { createError } from 'evlog'
import { CHAT_SEARCH_MAX_CALLS_PER_TURN } from '~~/server/utils/memory/tools/constants'

export const CHAT_SEARCH_LIMIT_MESSAGE = 'Chat history search limit for this '
  + 'message reached; answer from the results already gathered.'

export interface ChatSearchBudget {
  maxCalls: number
  usedCalls: number
}

/**
 * One budget is created per chat request and shared by `search_chats` and
 * `read_chat`, so a single model step that fans out parallel calls cannot
 * multiply the D1 reads. Create it per request, never at module scope: a
 * module-level counter would leak across requests on a reused Worker
 * isolate.
 */
export function createChatSearchBudget(
  maxCalls: number = CHAT_SEARCH_MAX_CALLS_PER_TURN,
): ChatSearchBudget {
  return { maxCalls, usedCalls: 0 }
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
      why: `This message already used ${budget.maxCalls} chat history calls.`,
      fix: 'Answer from the results already gathered.',
    })
  }

  budget.usedCalls += 1
}
