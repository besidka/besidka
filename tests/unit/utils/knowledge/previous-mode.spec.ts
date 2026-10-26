import { describe, expect, it } from 'vitest'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { readPreviousKnowledgeMode } from '~~/server/utils/knowledge/previous-mode'

function usage(overrides: Partial<MessageUsage> = {}): MessageUsage {
  return {
    model: 'gpt-5.5',
    provider: 'openai',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    ...overrides,
  } as MessageUsage
}

describe('readPreviousKnowledgeMode', () => {
  it('is null for a chat without messages', () => {
    expect(readPreviousKnowledgeMode([])).toBeNull()
  })

  it('is null when only user messages exist', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'user', usage: null },
    ])).toBeNull()
  })

  it.each(['full', 'search', 'none'] as const)(
    'reads %s from the newest assistant message',
    (mode) => {
      expect(readPreviousKnowledgeMode([
        { role: 'user', usage: null },
        { role: 'assistant', usage: usage({ knowledgeMode: mode }) },
        { role: 'user', usage: null },
      ])).toBe(mode)
    },
  )

  it('uses the newest assistant message, not an older one', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'assistant', usage: usage({ knowledgeMode: 'full' }) },
      { role: 'user', usage: null },
      { role: 'assistant', usage: usage({ knowledgeMode: 'search' }) },
    ])).toBe('search')
  })

  it('skips an assistant row without usage, which never reached the provider', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'assistant', usage: usage({ knowledgeMode: 'search' }) },
      { role: 'user', usage: null },
      { role: 'assistant', usage: null },
    ])).toBe('search')
  })

  it('is null for a message stored before the mode was recorded', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'assistant', usage: usage({ knowledgeTokens: 0 }) },
    ])).toBeNull()
  })

  it('does not reach past a newer message that carried no knowledge', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'assistant', usage: usage({ knowledgeMode: 'search' }) },
      { role: 'user', usage: null },
      { role: 'assistant', usage: usage() },
    ])).toBeNull()
  })

  it('ignores usage carried by a user message', () => {
    expect(readPreviousKnowledgeMode([
      { role: 'user', usage: usage({ knowledgeMode: 'search' }) },
    ])).toBeNull()
  })
})
