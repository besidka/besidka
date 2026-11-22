import { describe, expect, it } from 'vitest'
import {
  TOOL_ROUNDS_PER_MESSAGE,
  canContinueToolRound,
  isToolBudgetDataPart,
  readEndingToolBudget,
  readLastToolRound,
} from '#shared/utils/tool-rounds'

function budgetPart(round: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 'data-tool-budget',
    id: `tool-budget-${round}`,
    data: {
      round,
      maxRounds: TOOL_ROUNDS_PER_MESSAGE,
      reason: 'steps',
      model: 'deepseek-v4-pro',
      gateway: null,
      reasoning: 'high',
      connectorIds: ['c1'],
      ...overrides,
    },
  }
}

describe('tool rounds', () => {
  it('accepts only a well-formed budget part', () => {
    expect(isToolBudgetDataPart(budgetPart(1))).toBe(true)
    expect(isToolBudgetDataPart(budgetPart(0))).toBe(false)
    expect(isToolBudgetDataPart(budgetPart(1, { reason: 'time' })))
      .toBe(false)
    expect(isToolBudgetDataPart(budgetPart(1, { connectorIds: [1] })))
      .toBe(false)
    expect(isToolBudgetDataPart({ type: 'data-tool-budget' })).toBe(false)
  })

  it('reads the budget only when it ends the reply', () => {
    expect(readEndingToolBudget([{ type: 'text' }, budgetPart(2)]))
      .toMatchObject({ round: 2 })
    expect(readEndingToolBudget([budgetPart(2), { type: 'text' }]))
      .toBeNull()
    expect(readEndingToolBudget('nope')).toBeNull()
  })

  it('counts the highest round of the reply', () => {
    expect(readLastToolRound([budgetPart(1), { type: 'text' }, budgetPart(3)]))
      .toBe(3)
    expect(readLastToolRound([{ type: 'text' }])).toBe(0)
  })

  it('continues only below the round limit', () => {
    expect(canContinueToolRound([budgetPart(1)])).toBe(true)
    expect(canContinueToolRound([budgetPart(TOOL_ROUNDS_PER_MESSAGE)]))
      .toBe(false)
    expect(canContinueToolRound([{ type: 'text' }])).toBe(false)
  })
})
