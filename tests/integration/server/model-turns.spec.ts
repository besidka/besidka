import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import { getPersistedEmptyAnswerFailureText } from '#shared/utils/chat-failure-text'
import { sanitizeMessagesForModelContext } from '../../../server/utils/files/assistant-files'
import {
  buildMessagesForModel,
  GOOGLE_LEADING_ASSISTANT_PLACEHOLDER_TEXT,
  MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT,
} from '../../../server/utils/chats/model-turns'

const mocks = vi.hoisted(() => ({
  persistFile: vi.fn(),
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createAssistantMessage(
  id: string,
  parts: Array<Record<string, unknown>>,
): UIMessage {
  return {
    id,
    role: 'assistant',
    parts,
  } as UIMessage
}

const unsanitizedAssistantReplies: Array<{
  name: string
  parts: Array<Record<string, unknown>>
}> = [
  {
    name: 'reasoning-only',
    parts: [{ type: 'reasoning', text: 'Thinking it over', state: 'done' }],
  },
  {
    name: 'source-url-only',
    parts: [{
      type: 'source-url',
      sourceId: 'source-1',
      url: 'https://example.com',
    }],
  },
  {
    name: 'persisted failure-text-only',
    parts: [{
      type: 'text',
      text: getPersistedEmptyAnswerFailureText(),
    }],
  },
  {
    name: 'tool-only',
    parts: [{
      type: 'tool-web_search_brave',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'besidka' },
      output: { results: [] },
    }],
  },
]

describe('model-facing turn order', () => {
  describe.each(unsanitizedAssistantReplies)(
    'a $name assistant reply',
    ({ parts }) => {
      const history = [
        createUserMessage('user-1', 'First question'),
        createAssistantMessage('assistant-1', parts),
        createUserMessage('user-2', 'Second question'),
      ]

      it('is sanitized away, leaving two adjacent user turns', () => {
        const sanitizedMessages = sanitizeMessagesForModelContext(history)

        expect(sanitizedMessages.map(message => message.role)).toEqual([
          'user',
          'user',
        ])
      })

      it('is bridged by a placeholder reply for every provider',
        async () => {
          const sanitizedMessages = sanitizeMessagesForModelContext(history)
          const messagesForModel = buildMessagesForModel(
            sanitizedMessages,
            'openai',
          )
          const modelMessages = await convertToModelMessages(messagesForModel)

          expect(modelMessages.map(message => message.role)).toEqual([
            'user',
            'assistant',
            'user',
          ])
          expect(modelMessages[1]).toMatchObject({
            role: 'assistant',
            content: [{
              type: 'text',
              text: MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT,
            }],
          })
        })
    },
  )

  it('inserts a placeholder reply between every adjacent user pair', () => {
    const messages = [
      createUserMessage('user-1', 'One'),
      createUserMessage('user-2', 'Two'),
      createUserMessage('user-3', 'Three'),
    ]

    const messagesForModel = buildMessagesForModel(messages, 'anthropic')

    expect(messagesForModel.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(messagesForModel[1]?.id).toMatch(/^missing-reply-placeholder-/)
    expect(messages).toHaveLength(3)
  })

  it('prepends the user placeholder for google when history starts with '
    + 'an assistant message', () => {
    const messages = [
      createAssistantMessage('assistant-1', [{
        type: 'text',
        text: 'Stored answer',
      }]),
      createUserMessage('user-1', 'Follow-up'),
    ]

    const messagesForModel = buildMessagesForModel(messages, 'google')

    expect(messagesForModel.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(messagesForModel[0]).toMatchObject({
      parts: [{
        type: 'text',
        text: GOOGLE_LEADING_ASSISTANT_PLACEHOLDER_TEXT,
      }],
    })
    expect(messages).toHaveLength(2)
  })

  it('does not prepend a user placeholder for other providers', () => {
    const messages = [
      createAssistantMessage('assistant-1', [{
        type: 'text',
        text: 'Stored answer',
      }]),
      createUserMessage('user-1', 'Follow-up'),
    ]

    expect(buildMessagesForModel(messages, 'openai')).toBe(messages)
    expect(buildMessagesForModel(messages, undefined)).toBe(messages)
  })

  it('returns the same reference when turns already alternate', () => {
    const messages = [
      createUserMessage('user-1', 'Question'),
      createAssistantMessage('assistant-1', [{
        type: 'text',
        text: 'Answer',
      }]),
      createUserMessage('user-2', 'Follow-up'),
    ]

    expect(buildMessagesForModel(messages, 'google')).toBe(messages)
    expect(buildMessagesForModel(messages, 'openai')).toBe(messages)
  })
})
