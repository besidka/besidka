import { describe, expect, it } from 'vitest'
import {
  getMessageMetadata,
  getMessageUsedTools,
  resolveMessageMenuInfo,
} from '../../../shared/utils/message-metadata'

describe('getMessageMetadata', () => {
  it('returns usage and createdAt from message metadata', () => {
    const usage = {
      model: 'gpt-5.4',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    }

    const result = getMessageMetadata({
      metadata: { usage, createdAt: 'x' },
    })

    expect(result).toEqual({ usage, createdAt: 'x' })
  })

  it('falls back to the top-level createdAt when no metadata', () => {
    const result = getMessageMetadata({ createdAt: 'top-level' })

    expect(result).toEqual({
      usage: undefined,
      createdAt: 'top-level',
    })
  })

  it('returns undefined usage and createdAt for an empty message', () => {
    const result = getMessageMetadata({})

    expect(result).toEqual({ usage: undefined, createdAt: undefined })
  })
})

describe('getMessageUsedTools', () => {
  it('returns web_search when a source-url part is present', () => {
    const result = getMessageUsedTools({
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'source-url' },
      ],
    })

    expect(result).toEqual(['web_search'])
  })

  it('returns web_search when a source-document part is present', () => {
    const result = getMessageUsedTools({
      parts: [{ type: 'source-document' }],
    })

    expect(result).toEqual(['web_search'])
  })

  it('returns an empty array for text-only parts', () => {
    const result = getMessageUsedTools({
      parts: [{ type: 'text', text: 'hello' }],
    })

    expect(result).toEqual([])
  })

  it('returns an empty array when parts is missing', () => {
    expect(getMessageUsedTools({})).toEqual([])
  })

  it('returns an empty array when parts is not an array', () => {
    expect(getMessageUsedTools({ parts: 'not-an-array' })).toEqual([])
  })

  it('returns deep_research when a data-research part is present', () => {
    const result = getMessageUsedTools({
      parts: [
        { type: 'text', text: 'Report' },
        { type: 'data-research', data: {} },
      ],
    })

    expect(result).toEqual(['deep_research'])
  })

  it('prefers deep_research over web_search when both parts are present', () => {
    const result = getMessageUsedTools({
      parts: [
        { type: 'data-research', data: {} },
        { type: 'source-url' },
      ],
    })

    expect(result).toEqual(['deep_research'])
  })
})

describe('resolveMessageMenuInfo', () => {
  const assistantUsage = {
    model: 'gpt-5.4',
    provider: 'openai',
    inputTokens: 5240,
    outputTokens: 1180,
    reasoningTokens: 320,
    totalTokens: 6420,
    inputCost: 0.0131,
    outputCost: 0.0177,
  }

  it('returns null when no message is selected', () => {
    expect(resolveMessageMenuInfo([], null)).toBeNull()
  })

  it('returns null when the selected message is not found', () => {
    const messages = [{ id: 'a1', role: 'assistant' }]

    expect(resolveMessageMenuInfo(messages, 'missing')).toBeNull()
  })

  it('resolves assistant info from its own usage', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant',
      metadata: { usage: assistantUsage, createdAt: 'when' },
      parts: [{ type: 'source-url' }],
    }]

    expect(resolveMessageMenuInfo(messages, 'a1')).toEqual({
      role: 'assistant',
      createdAt: 'when',
      model: 'gpt-5.4',
      usedTools: ['web_search'],
      tokens: 1180,
      reasoningTokens: 320,
      cost: 0.0177,
      costToMessage: 0.0177,
      chatTotalCost: 0.0177,
    })
  })

  it('resolves deep_research usedTools for a research report message', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant',
      metadata: { usage: assistantUsage, createdAt: 'when' },
      parts: [
        { type: 'data-research', data: { provider: 'openai' } },
        { type: 'source-url' },
      ],
    }]

    expect(resolveMessageMenuInfo(messages, 'a1')?.usedTools).toEqual(
      ['deep_research'],
    )
  })

  it('exposes the stored reasoning level for assistant messages', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant',
      metadata: { usage: assistantUsage },
      reasoning: 'medium' as const,
    }]

    expect(resolveMessageMenuInfo(messages, 'a1')?.reasoning).toBe('medium')
  })

  it('attributes the input side of the next reply to a user message', () => {
    const messages = [
      { id: 'u1', role: 'user', metadata: { createdAt: 'sent' } },
      { id: 'a1', role: 'assistant', metadata: { usage: assistantUsage } },
    ]

    expect(resolveMessageMenuInfo(messages, 'u1')).toEqual({
      role: 'user',
      createdAt: 'sent',
      tokens: 5240,
      cost: 0.0131,
      costToMessage: 0.0131,
      chatTotalCost: 0.0131 + 0.0177,
    })
  })

  it('does not borrow usage across an intervening user message', () => {
    const messages = [
      { id: 'u1', role: 'user', metadata: { createdAt: 'first' } },
      { id: 'u2', role: 'user', metadata: { createdAt: 'second' } },
      { id: 'a1', role: 'assistant', metadata: { usage: assistantUsage } },
    ]

    expect(resolveMessageMenuInfo(messages, 'u1')).toEqual({
      role: 'user',
      createdAt: 'first',
      tokens: undefined,
      cost: undefined,
      costToMessage: undefined,
      chatTotalCost: 0.0131 + 0.0177,
    })
  })

  it('leaves a trailing user message without token or cost data', () => {
    const messages = [
      { id: 'a1', role: 'assistant', metadata: { usage: assistantUsage } },
      { id: 'u1', role: 'user', metadata: { createdAt: 'last' } },
    ]

    const info = resolveMessageMenuInfo(messages, 'u1')

    expect(info).toEqual({
      role: 'user',
      createdAt: 'last',
      tokens: undefined,
      cost: undefined,
      costToMessage: 0.0177,
      chatTotalCost: 0.0177,
    })
    expect(info?.costToMessage).toBe(info?.chatTotalCost)
  })
})

describe('resolveMessageMenuInfo cumulative cost totals', () => {
  function buildUsage(inputCost: number, outputCost: number) {
    return {
      model: 'gpt-5.4',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      inputCost,
      outputCost,
    }
  }

  const usage1 = buildUsage(0.01, 0.02)
  const usage2 = buildUsage(0.03, 0.04)
  const usage3 = buildUsage(0.05, 0.06)

  const messages = [
    { id: 'u1', role: 'user', metadata: { createdAt: 'turn-1-user' } },
    { id: 'a1', role: 'assistant', metadata: { usage: usage1 } },
    { id: 'u2', role: 'user', metadata: { createdAt: 'turn-2-user' } },
    { id: 'a2', role: 'assistant', metadata: { usage: usage2 } },
    { id: 'u3', role: 'user', metadata: { createdAt: 'turn-3-user' } },
    { id: 'a3', role: 'assistant', metadata: { usage: usage3 } },
  ]

  const chatTotal = 0.01 + 0.02 + 0.03 + 0.04 + 0.05 + 0.06

  it('accumulates a running total up to each assistant message', () => {
    expect(resolveMessageMenuInfo(messages, 'a1')?.costToMessage)
      .toBe(0.01 + 0.02)
    expect(resolveMessageMenuInfo(messages, 'a2')?.costToMessage)
      .toBe(0.01 + 0.02 + 0.03 + 0.04)
    expect(resolveMessageMenuInfo(messages, 'a3')?.costToMessage)
      .toBe(chatTotal)
  })

  it('includes a user message\'s own turn input in its cumulative total', () => {
    const info = resolveMessageMenuInfo(messages, 'u2')

    expect(info?.cost).toBe(0.03)
    expect(info?.costToMessage).toBe(0.01 + 0.02 + 0.03)
  })

  it('reports the same chat total regardless of the selected message', () => {
    expect(resolveMessageMenuInfo(messages, 'u1')?.chatTotalCost)
      .toBe(chatTotal)
    expect(resolveMessageMenuInfo(messages, 'a2')?.chatTotalCost)
      .toBe(chatTotal)
    expect(resolveMessageMenuInfo(messages, 'u3')?.chatTotalCost)
      .toBe(chatTotal)
  })

  it('makes the last message\'s cumulative total equal the chat total', () => {
    const info = resolveMessageMenuInfo(messages, 'a3')

    expect(info?.costToMessage).toBe(info?.chatTotalCost)
    expect(info?.costToMessage).toBe(chatTotal)
  })
})
