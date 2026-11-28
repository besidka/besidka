import { describe, expect, it, vi } from 'vitest'
import {
  consumeExternalSearchCall,
  createExternalSearchBudget,
  EXTERNAL_SEARCH_LIMIT_MESSAGE,
  EXTERNAL_SEARCH_MAX_CALLS_PER_TURN,
  EXTERNAL_SEARCH_MAX_TOOL_STEPS,
  EXTERNAL_SEARCH_TOOL_GUIDANCE,
  DEEPSEEK_SEARCH_MAX_CALLS_PER_TURN,
} from '../../../../server/utils/search/search-budget'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

describe('external search budget', () => {
  it('allows 12 calls per turn by default', () => {
    expect(EXTERNAL_SEARCH_MAX_CALLS_PER_TURN).toBe(12)
    expect(createExternalSearchBudget().maxCalls).toBe(12)
  })

  it('allows 8 tool steps, below the call cap so a step can fan out', () => {
    expect(EXTERNAL_SEARCH_MAX_TOOL_STEPS).toBe(8)
    expect(EXTERNAL_SEARCH_MAX_CALLS_PER_TURN)
      .toBeGreaterThan(EXTERNAL_SEARCH_MAX_TOOL_STEPS)
  })

  it('keeps DeepSeek search on its own cap of 8 calls', () => {
    expect(DEEPSEEK_SEARCH_MAX_CALLS_PER_TURN).toBe(8)
  })

  it('tells the model the per-reply search allowance', () => {
    expect(EXTERNAL_SEARCH_TOOL_GUIDANCE).toContain('Start with one broad query')
    expect(EXTERNAL_SEARCH_TOOL_GUIDANCE).toContain('up to 12 searches')
  })

  it('refuses the 13th call with the limit message and a derived reason',
    () => {
      const budget = createExternalSearchBudget()

      for (let call = 0; call < 12; call++) {
        consumeExternalSearchCall(budget)
      }

      let exception: unknown

      try {
        consumeExternalSearchCall(budget)
      } catch (caught) {
        exception = caught
      }

      expect(exception).toMatchObject({
        message: EXTERNAL_SEARCH_LIMIT_MESSAGE,
        status: 429,
        why: 'This message already used 12 web searches.',
      })
      expect(budget.usedCalls).toBe(12)
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
