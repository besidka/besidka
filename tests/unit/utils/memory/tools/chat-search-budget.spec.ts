import { describe, expect, it } from 'vitest'
import {
  CHAT_SEARCH_LIMIT_MESSAGE,
  consumeChatSearchCall,
  createChatSearchBudget,
} from '~~/server/utils/memory/tools/chat-search-budget'
import { CHAT_SEARCH_MAX_CALLS_PER_TURN } from '~~/server/utils/memory/tools/constants'

describe('createChatSearchBudget', () => {
  it('defaults to three calls per turn with none used', () => {
    expect(CHAT_SEARCH_MAX_CALLS_PER_TURN).toBe(3)
    expect(createChatSearchBudget()).toEqual({ maxCalls: 3, usedCalls: 0 })
  })

  it('accepts a custom maximum', () => {
    expect(createChatSearchBudget(5).maxCalls).toBe(5)
  })

  it('returns an independent budget on every call', () => {
    const first = createChatSearchBudget()
    const second = createChatSearchBudget()

    consumeChatSearchCall(first)
    consumeChatSearchCall(first)

    expect(first.usedCalls).toBe(2)
    expect(second.usedCalls).toBe(0)
  })
})

describe('consumeChatSearchCall', () => {
  it('lets the first three calls through and counts them', () => {
    const budget = createChatSearchBudget()

    for (let call = 1; call <= 3; call += 1) {
      expect(() => consumeChatSearchCall(budget)).not.toThrow()
      expect(budget.usedCalls).toBe(call)
    }
  })

  it('throws a 429 on the fourth call without spending it', () => {
    const budget = createChatSearchBudget()

    consumeChatSearchCall(budget)
    consumeChatSearchCall(budget)
    consumeChatSearchCall(budget)

    let thrown: unknown

    try {
      consumeChatSearchCall(budget)
    } catch (exception) {
      thrown = exception
    }

    expect(thrown).toMatchObject({
      status: 429,
      message: CHAT_SEARCH_LIMIT_MESSAGE,
    })
    expect(budget.usedCalls).toBe(3)
  })

  it('keeps throwing once the budget is exhausted', () => {
    const budget = createChatSearchBudget(1)

    consumeChatSearchCall(budget)

    expect(() => consumeChatSearchCall(budget)).toThrow()
    expect(() => consumeChatSearchCall(budget)).toThrow()
    expect(budget.usedCalls).toBe(1)
  })
})
