import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  findNextToolRound,
  resolveAutoToolRound,
  toolRoundKey,
} from '../../../app/composables/tool-rounds'

function budgetMessage(round: number, maxRounds = 10): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Working.' },
      {
        type: 'data-tool-budget',
        data: {
          round,
          maxRounds,
          reason: 'steps',
          model: 'm',
          gateway: null,
          reasoning: 'off',
          connectorIds: [],
        },
      },
    ],
  } as UIMessage
}

describe('tool round helpers', () => {
  it('finds the next round of a reply that ends with a budget part', () => {
    expect(findNextToolRound([budgetMessage(2)]))
      .toEqual({ messageId: 'assistant-1', round: 3 })
    expect(findNextToolRound([budgetMessage(10)])).toBeNull()
    expect(findNextToolRound([
      budgetMessage(2),
      { id: 'u', role: 'user', parts: [] } as UIMessage,
    ])).toBeNull()
  })

  it('runs a round by itself once, never after the user stopped', () => {
    const messages = [budgetMessage(1)]
    const next = { messageId: 'assistant-1', round: 2 }

    expect(resolveAutoToolRound(messages, {
      isHalted: false,
      requestedKeys: new Set(),
    })).toEqual(next)
    expect(resolveAutoToolRound(messages, {
      isHalted: false,
      requestedKeys: new Set([toolRoundKey(next)]),
    })).toBeNull()
    expect(resolveAutoToolRound(messages, {
      isHalted: true,
      requestedKeys: new Set(),
    })).toBeNull()
  })
})
