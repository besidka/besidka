import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import {
  normalizeAssistantMessagePartsForPersistence,
  sanitizeMessagesForModelContext,
} from '../../../server/utils/files/assistant-files'

describe('assistant files scaffolding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only assistant text parts in model context messages', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-with-text-and-file',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'summary',
          },
          {
            type: 'reasoning',
            text: 'hidden chain of thought summary',
          },
          {
            type: 'tool-web_search_preview',
            toolCallId: 'ws_123',
            state: 'output-available',
            input: {},
            output: {},
            providerExecuted: true,
          },
          {
            type: 'source-url',
            sourceId: 'source-1',
            url: 'https://example.com',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'report.pdf',
            url: '/files/report.pdf',
          },
        ],
      } as any,
      {
        id: 'assistant-file-only',
        role: 'assistant',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'chart.png',
            url: '/files/chart.png',
          },
        ],
      } as any,
      {
        id: 'user-file',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'please summarize this',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'source.pdf',
            url: '/files/source.pdf',
            providerMetadata: {
              openai: {
                itemId: 'file_123',
              },
            },
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(2)
    expect(sanitizedMessages[0]?.id).toBe('assistant-with-text-and-file')
    expect(sanitizedMessages[0]?.parts).toEqual([
      {
        type: 'text',
        text: 'summary',
      },
    ])
    expect(sanitizedMessages[1]?.id).toBe('user-file')
    expect(sanitizedMessages[1]?.parts).toEqual([
      {
        type: 'text',
        text: 'please summarize this',
      },
      {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'source.pdf',
        url: '/files/source.pdf',
      },
    ])
  })

  it('prevents AI SDK model context from replaying assistant artifacts', async () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-with-artifacts',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'The search result says Cloudflare limits memory.',
            providerMetadata: {
              openai: {
                itemId: 'msg_123',
              },
            },
          },
          {
            type: 'reasoning',
            text: 'Provider-specific reasoning summary.',
          },
          {
            type: 'tool-web_search_preview',
            toolCallId: 'ws_123',
            state: 'output-available',
            input: {},
            output: {},
            providerExecuted: true,
          },
          {
            type: 'source-url',
            sourceId: 'source-1',
            url: 'https://example.com',
          },
        ],
      } as any,
      {
        id: 'latest-user-text-and-file',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Continue.',
            providerMetadata: {
              openai: {
                itemId: 'user_msg_123',
              },
            },
          },
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'notes.txt',
            url: 'data:text/plain;base64,SGVsbG8=',
            providerMetadata: {
              openai: {
                itemId: 'file_123',
              },
            },
          },
        ],
      } as any,
    ]

    const modelMessages = await convertToModelMessages(
      sanitizeMessagesForModelContext(messages),
    )

    expect(modelMessages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The search result says Cloudflare limits memory.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Continue.',
          },
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'notes.txt',
            data: 'data:text/plain;base64,SGVsbG8=',
          },
        ],
      },
    ])
  })

  it('replaces old user file parts with placeholders', () => {
    const messages: UIMessage[] = [
      {
        id: 'old-user-file',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'please summarize this',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'source.pdf',
            url: '/files/source.pdf',
          },
        ],
      } as any,
      {
        id: 'latest-user-file',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'now summarize this',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'latest.pdf',
            url: '/files/latest.pdf',
            providerMetadata: {
              openai: {
                itemId: 'latest_file_123',
              },
            },
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages[0]?.parts).toEqual([
      {
        type: 'text',
        text: 'please summarize this',
      },
      {
        type: 'text',
        text: 'Previously attached file omitted from model context: source.pdf.',
      },
    ])
    expect(sanitizedMessages[1]?.parts).toEqual([
      {
        type: 'text',
        text: 'now summarize this',
      },
      {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'latest.pdf',
        url: '/files/latest.pdf',
      },
    ])
  })

  it('logs assistant file detection when persistence is disabled', async () => {
    const loggerSet = vi.fn()

    vi.stubGlobal('useRuntimeConfig', () => ({
      enableAssistantFilePersistence: false,
    }))

    const parts: UIMessage['parts'] = [
      {
        type: 'text',
        text: 'Here is your file.',
      },
      {
        type: 'file',
        mediaType: 'text/plain',
        filename: 'result.txt',
        url: 'data:text/plain;base64,SGVsbG8=',
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'openai',
      chatId: 'chat-1',
      userId: 1,
      logger: {
        set: loggerSet,
      },
    })

    expect(normalizedParts).toEqual(parts)
    expect(loggerSet).toHaveBeenCalledWith({
      assistantFiles: {
        action: 'skipped-feature-disabled',
        count: 1,
        chatId: 'chat-1',
        providerId: 'openai',
        userId: 1,
      },
    })
  })

  it('does not log when assistant parts contain no files', async () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [
      {
        type: 'text',
        text: 'No files in this response',
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'google',
      chatId: 'chat-2',
      userId: 2,
      logger: {
        set: loggerSet,
      },
    })

    expect(normalizedParts).toEqual(parts)
    expect(loggerSet).not.toHaveBeenCalled()
  })
})
