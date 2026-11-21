import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { buildModelContextMessages } from '~~/server/utils/files/assistant-files'

describe('buildModelContextMessages', () => {
  it('never sends a built-in command or its report to a model', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
      {
        id: 'u2',
        role: 'user',
        parts: [
          { type: 'text', text: '7d' },
          { type: 'data-command-invocation', data: { command: 'stats' } },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          { type: 'data-command-report', data: { command: 'stats' } },
          { type: 'text', text: '```text\nREPORT\n```' },
        ],
      },
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Next' }] },
    ] as unknown as UIMessage[]

    expect(buildModelContextMessages(messages).messages.map((message) => {
      return message.id
    })).toEqual(['u1', 'a1', 'u3'])
  })
})
