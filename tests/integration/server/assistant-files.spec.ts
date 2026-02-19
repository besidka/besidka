import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  normalizeAssistantMessagePartsForPersistence,
  sanitizeMessagesForModelContext,
} from '../../../server/utils/files/assistant-files'

describe('assistant files scaffolding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes assistant file parts from model context messages', () => {
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
    expect(sanitizedMessages[1]?.parts).toHaveLength(2)
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
