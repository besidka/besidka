import { describe, expect, it } from 'vitest'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import type { McpChatMessageRow } from '~~/server/utils/mcp/private/chats'
import {
  buildMcpChatTranscript,
  clampMcpLimit,
  cleanSearchSnippet,
  collectChatModels,
  extractMessageText,
  mergeChatSearchResults,
} from '~~/server/utils/mcp/private/chats'
import { MCP_TRUNCATION_MARKER, truncateMcpText } from '~~/server/utils/mcp/private/text'

function messageRow(
  index: number,
  role: string,
  text: string,
  model?: string,
): McpChatMessageRow {
  return {
    publicId: `m${index}`,
    role,
    parts: [
      { type: 'step-start' },
      { type: 'reasoning', text: 'hidden reasoning' },
      { type: 'text', text },
      { type: 'file', url: 'https://example.com/a.png' },
    ],
    usage: model
      ? {
        model,
        provider: 'openai',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }
      : null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
  }
}

function chatRow(id: string, title: string) {
  return {
    id,
    slug: `slug-${id}`,
    title,
    projectId: null,
    pinnedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1)),
    activityAt: new Date(Date.UTC(2026, 9, 2)),
  }
}

describe('extractMessageText', () => {
  it('keeps only text parts', () => {
    expect(extractMessageText(messageRow(1, 'user', 'hello').parts))
      .toBe('hello')
    expect(extractMessageText([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])).toBe('a\n\nb')
    expect(extractMessageText(null)).toBe('')
  })
})

describe('buildMcpChatTranscript', () => {
  it('returns messages newest-last with the assistant model', () => {
    const transcript = buildMcpChatTranscript([
      messageRow(2, 'assistant', 'answer', 'gpt-5'),
      messageRow(1, 'user', 'question'),
    ], { messageMaxChars: 100, totalMaxChars: 1000 })

    expect(transcript).toEqual({
      messages: [
        {
          id: 'm1',
          role: 'user',
          createdAt: '2026-10-01T00:01:00.000Z',
          text: 'question',
        },
        {
          id: 'm2',
          role: 'assistant',
          model: 'gpt-5',
          createdAt: '2026-10-01T00:02:00.000Z',
          text: 'answer',
        },
      ],
      omittedMessages: 0,
      truncated: false,
    })
  })

  it('truncates long messages and drops the oldest past the total cap',
    () => {
      const transcript = buildMcpChatTranscript([
        messageRow(3, 'assistant', 'c'.repeat(60)),
        messageRow(2, 'user', 'b'.repeat(60)),
        messageRow(1, 'user', 'a'.repeat(60)),
      ], { messageMaxChars: 50, totalMaxChars: 100 })

      expect(transcript.truncated).toBe(true)
      expect(transcript.omittedMessages).toBe(1)
      expect(transcript.messages.map(message => message.id))
        .toEqual(['m2', 'm3'])
      expect(transcript.messages[1]?.text.length).toBe(50)
      expect(transcript.messages[1]?.truncated).toBe(true)

      const totalChars = transcript.messages.reduce((sum, message) => {
        return sum + message.text.length
      }, 0)

      expect(totalChars).toBeLessThanOrEqual(100)
    })
})

describe('collectChatModels', () => {
  it('lists each model once', () => {
    expect(collectChatModels([
      messageRow(3, 'assistant', 'x', 'gpt-5'),
      messageRow(2, 'assistant', 'y', 'claude-opus'),
      messageRow(1, 'assistant', 'z', 'gpt-5'),
    ])).toEqual(['gpt-5', 'claude-opus'])
  })
})

describe('mergeChatSearchResults', () => {
  it('puts title matches first and marks content-only matches', () => {
    const merged = mergeChatSearchResults(
      [chatRow('a', 'Trip plan')],
      [
        { chatId: 'a', messageRowId: 1, score: -2, snippet: 'x' },
        {
          chatId: 'b',
          messageRowId: 2,
          score: -1,
          snippet: `the ${SNIPPET_START}trip${SNIPPET_END} itself`,
        },
        { chatId: 'gone', messageRowId: 3, score: 0, snippet: 'y' },
      ],
      new Map([['b', chatRow('b', 'Other')]]),
    )

    expect(merged.map((chat) => {
      return [chat.slug, chat.matchedIn, chat.snippet]
    })).toEqual([
      ['slug-a', 'both', 'x'],
      ['slug-b', 'content', 'the trip itself'],
    ])
  })
})

describe('chat helpers', () => {
  it('clamps limits', () => {
    expect(clampMcpLimit(undefined, 20, 50)).toBe(20)
    expect(clampMcpLimit(500, 20, 50)).toBe(50)
    expect(clampMcpLimit(0, 20, 50)).toBe(1)
    expect(clampMcpLimit(7.9, 20, 50)).toBe(7)
  })

  it('strips snippet markers', () => {
    expect(cleanSearchSnippet(`${SNIPPET_START}a${SNIPPET_END}b`))
      .toBe('ab')
  })

  it('truncates text with a marker and never splits a surrogate pair', () => {
    expect(truncateMcpText('short', 10)).toEqual({
      text: 'short',
      truncated: false,
    })

    const limit = MCP_TRUNCATION_MARKER.length + 2
    const result = truncateMcpText(`a😀${'b'.repeat(20)}`, limit)

    expect(result.truncated).toBe(true)
    expect(result.text).toBe(`a${MCP_TRUNCATION_MARKER}`)
  })
})
