import { describe, expect, it, vi } from 'vitest'
import {
  consumeExternalSearchCall,
  createExternalSearchBudget,
  EXTERNAL_SEARCH_LIMIT_MESSAGE,
  EXTERNAL_SEARCH_MAX_CALLS_PER_TURN,
} from '../../../../server/utils/search/search-budget'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

describe('external search budget', () => {
  it('allows 8 calls per turn by default', () => {
    expect(EXTERNAL_SEARCH_MAX_CALLS_PER_TURN).toBe(8)
    expect(createExternalSearchBudget().maxCalls).toBe(8)
  })

  it('throws the limit message once the budget is spent', () => {
    const budget = createExternalSearchBudget(2)

    consumeExternalSearchCall(budget)
    consumeExternalSearchCall(budget)

    expect(() => consumeExternalSearchCall(budget)).toThrow(
      EXTERNAL_SEARCH_LIMIT_MESSAGE,
    )
    expect(budget.usedCalls).toBe(2)
  })

  it('creates an independent budget on every call', () => {
    const first = createExternalSearchBudget(1)
    const second = createExternalSearchBudget(1)

    consumeExternalSearchCall(first)

    expect(() => consumeExternalSearchCall(second)).not.toThrow()
  })
})
