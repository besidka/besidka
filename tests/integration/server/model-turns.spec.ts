import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import { getPersistedEmptyAnswerFailureText } from '#shared/utils/chat-failure-text'
import { sanitizeMessagesForModelContext } from '../../../server/utils/files/assistant-files'
import {
  appendTextToLastUserTurn,
  buildKnowledgeMediaTurns,
  buildMessagesForModel,
  DELETED_USER_MESSAGE_PLACEHOLDER_TEXT,
  KNOWLEDGE_MEDIA_TURN_TEXT,
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
        text: DELETED_USER_MESSAGE_PLACEHOLDER_TEXT,
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

  it('inserts a user placeholder between adjacent assistant turns for '
    + 'every provider', () => {
    const messages = [
      createUserMessage('user-1', 'First question'),
      createAssistantMessage('assistant-1', [{
        type: 'text',
        text: 'First answer',
      }]),
      createAssistantMessage('assistant-2', [{
        type: 'text',
        text: 'Second answer',
      }]),
      createUserMessage('user-3', 'Third question'),
    ]

    const messagesForModel = buildMessagesForModel(messages, 'openai')

    expect(messagesForModel.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(messagesForModel[2]?.id).toMatch(/^deleted-user-placeholder-/)
    expect(messagesForModel[2]).toMatchObject({
      parts: [{
        type: 'text',
        text: DELETED_USER_MESSAGE_PLACEHOLDER_TEXT,
      }],
    })
    expect(messages).toHaveLength(4)
  })

  it('bridges a run of three adjacent assistant turns', () => {
    const messages = [
      createAssistantMessage('assistant-1', [{ type: 'text', text: 'One' }]),
      createAssistantMessage('assistant-2', [{ type: 'text', text: 'Two' }]),
      createAssistantMessage('assistant-3', [{ type: 'text', text: 'Three' }]),
    ]

    const messagesForModel = buildMessagesForModel(messages, 'anthropic')

    expect(messagesForModel.map(message => message.role)).toEqual([
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })

  it('combines the google leading placeholder with adjacent user turns',
    () => {
      const messages = [
        createAssistantMessage('assistant-1', [{
          type: 'text',
          text: 'Stored answer',
        }]),
        createUserMessage('user-1', 'One'),
        createUserMessage('user-2', 'Two'),
      ]

      const messagesForModel = buildMessagesForModel(messages, 'google')

      expect(messagesForModel.map(message => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
        'user',
      ])
      expect(messagesForModel[0]).toMatchObject({
        parts: [{
          type: 'text',
          text: DELETED_USER_MESSAGE_PLACEHOLDER_TEXT,
        }],
      })
      expect(messagesForModel[3]).toMatchObject({
        parts: [{
          type: 'text',
          text: MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT,
        }],
      })
      expect(messages).toHaveLength(3)
    })

  it('returns the same reference for an empty history', () => {
    const messages: UIMessage[] = []

    expect(buildMessagesForModel(messages, 'google')).toBe(messages)
    expect(buildMessagesForModel(messages, 'openai')).toBe(messages)
  })
})

describe('project knowledge media turns', () => {
  const mediaParts = [
    {
      type: 'file' as const,
      mediaType: 'image/png',
      url: '/files/user-1/diagram.png',
      filename: 'diagram.png',
    },
    {
      type: 'file' as const,
      mediaType: 'application/pdf',
      url: '/files/user-1/contract.pdf',
      filename: 'contract.pdf',
    },
  ]

  it('returns no turns without media parts', () => {
    expect(buildKnowledgeMediaTurns([])).toEqual([])
  })

  it('builds a leading user turn with the files and an assistant '
    + 'placeholder', () => {
    const turns = buildKnowledgeMediaTurns(mediaParts)

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: KNOWLEDGE_MEDIA_TURN_TEXT },
        ...mediaParts,
      ],
    })
    expect(turns[1]).toMatchObject({
      role: 'assistant',
      parts: [{
        type: 'text',
        text: MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT,
      }],
    })
    expect(turns[0]?.parts[1]).not.toBe(mediaParts[0])
  })

  it('keeps ids stable across calls so the cached prefix does not change',
    () => {
      const first = buildKnowledgeMediaTurns(mediaParts)
      const second = buildKnowledgeMediaTurns(mediaParts)

      expect(first.map(turn => turn.id)).toEqual(second.map(turn => turn.id))
    })

  it('keeps a Google history leading with a user turn and alternating when '
    + 'it is prepended to a history that starts with an assistant turn',
  () => {
    const history = [
      createAssistantMessage('assistant-1', [{ type: 'text', text: 'Hi.' }]),
      createUserMessage('user-1', 'Summarize the contract.'),
    ]
    const messagesForModel = buildMessagesForModel(
      [...buildKnowledgeMediaTurns(mediaParts), ...history],
      'google',
    )
    const roles = messagesForModel.map(message => message.role)

    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(messagesForModel[0]?.parts[0]).toEqual({
      type: 'text',
      text: KNOWLEDGE_MEDIA_TURN_TEXT,
    })
    expect(messagesForModel[2]).toMatchObject({
      parts: [{ type: 'text', text: DELETED_USER_MESSAGE_PLACEHOLDER_TEXT }],
    })
    expect(history).toHaveLength(2)
  })

  it('keeps a history that starts with a user turn alternating', () => {
    const messagesForModel = buildMessagesForModel([
      ...buildKnowledgeMediaTurns(mediaParts),
      createUserMessage('user-1', 'What does the diagram show?'),
    ], 'google')

    expect(messagesForModel.map(message => message.role))
      .toEqual(['user', 'assistant', 'user'])
  })
})

describe('appendTextToLastUserTurn', () => {
  it('appends a text part to a copy of the last user turn', () => {
    const lastUserMessage = createUserMessage('user-2', 'What is the fee?')
    const messages = [
      createUserMessage('user-1', 'Hello'),
      createAssistantMessage('assistant-1', [{ type: 'text', text: 'Hi.' }]),
      lastUserMessage,
    ]
    const result = appendTextToLastUserTurn(messages, 'excerpts')

    expect(result).not.toBe(messages)
    expect(result[2]).not.toBe(lastUserMessage)
    expect(result[2]?.parts).toEqual([
      { type: 'text', text: 'What is the fee?' },
      { type: 'text', text: 'excerpts' },
    ])
    expect(lastUserMessage.parts).toHaveLength(1)
    expect(messages[2]).toBe(lastUserMessage)
    expect(result[0]).toBe(messages[0])
  })

  it('returns the input unchanged when the last turn is not a user turn',
    () => {
      const messages = [
        createUserMessage('user-1', 'Hello'),
        createAssistantMessage('assistant-1', [{ type: 'text', text: 'Hi.' }]),
      ]

      expect(appendTextToLastUserTurn(messages, 'excerpts')).toBe(messages)
      expect(appendTextToLastUserTurn([], 'excerpts')).toEqual([])
    })
})
