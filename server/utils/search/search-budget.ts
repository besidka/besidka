import { createError } from 'evlog'

export const EXTERNAL_SEARCH_MAX_CALLS_PER_TURN = 8

export const EXTERNAL_SEARCH_LIMIT_MESSAGE = 'Search limit for this message '
  + 'reached; answer from the results already gathered.'

export interface ExternalSearchBudget {
  maxCalls: number
  usedCalls: number
}

/**
 * One budget is created per chat request and shared by every Brave/Exa tool
 * `execute`, so a single model step that fans out many parallel search calls
 * cannot multiply the provider requests the user is billed for. Create it
 * per request, never at module scope: a module-level counter would leak
 * across requests on a reused Worker isolate.
 */
export function createExternalSearchBudget(
  maxCalls: number = EXTERNAL_SEARCH_MAX_CALLS_PER_TURN,
): ExternalSearchBudget {
  return { maxCalls, usedCalls: 0 }
}

/**
 * Spends one call from the budget, or throws before any provider request is
 * made. The throw inside a tool `execute()` becomes a `tool-error` part, not
 * a stream failure, so the model reads `message` and answers from the
 * results it already has; a `tool-error` is also never counted as a billable
 * search (see `getExternalSearchUsage`).
 */
export function consumeExternalSearchCall(budget: ExternalSearchBudget) {
  if (budget.usedCalls >= budget.maxCalls) {
    throw createError({
      message: EXTERNAL_SEARCH_LIMIT_MESSAGE,
      status: 429,
      why: `This message already used ${budget.maxCalls} web searches.`,
      fix: 'Answer from the results already gathered.',
    })
  }

  budget.usedCalls += 1
}
