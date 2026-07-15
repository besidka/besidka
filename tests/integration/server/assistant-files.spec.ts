import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import {
  getGeneratedImageFileIds,
  normalizeAssistantMessagePartsForPersistence,
  sanitizeMessagesForModelContext,
} from '../../../server/utils/files/assistant-files'

function createGeneratedImageFileRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'file-1',
    storageKey: 'generated.webp',
    name: 'quiet-forest.webp',
    size: 123,
    type: 'image/webp',
    source: 'assistant',
    originProvider: 'openai',
    ...overrides,
  }
}

function stubGeneratedImageFile(
  file: ReturnType<typeof createGeneratedImageFileRow> | undefined,
) {
  const findFirst = vi.fn(async () => file)

  vi.stubGlobal('useDb', () => ({
    query: {
      files: { findFirst },
    },
  }))

  return findFirst
}

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

    expect(sanitizedMessages).toHaveLength(3)
    expect(sanitizedMessages[0]?.id).toBe('assistant-with-text-and-file')
    expect(sanitizedMessages[0]?.parts).toEqual([
      {
        type: 'text',
        text: 'summary',
      },
      {
        type: 'text',
        text: 'Generated file saved in the user file library: report.pdf (application/pdf).',
      },
    ])
    expect(sanitizedMessages[1]?.parts).toEqual([
      {
        type: 'text',
        text: 'Generated file saved in the user file library: chart.png (image/png).',
      },
    ])
    expect(sanitizedMessages[2]?.id).toBe('user-file')
    expect(sanitizedMessages[2]?.parts).toEqual([
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
            data: {
              type: 'url',
              url: new URL('data:text/plain;base64,SGVsbG8='),
            },
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

  it('normalizes a ready generated image tool to a private file part', async () => {
    const loggerSet = vi.fn()

    stubGeneratedImageFile(createGeneratedImageFileRow())

    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-1',
        state: 'output-available',
        input: { prompt: 'A quiet forest' },
        output: {
          status: 'ready',
          file: {
            id: 'file-1',
            storageKey: 'generated.webp',
            name: 'quiet-forest.webp',
            size: 123,
            type: 'image/webp',
            source: 'assistant',
            expiresAt: null,
            url: 'javascript:alert(1)',
            downloadUrl: 'https://attacker.example/steal',
          },
          provider: 'openai',
          model: 'gpt-image-2',
        },
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'openai',
      chatId: 'chat-3',
      userId: 3,
      logger: { set: loggerSet },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'quiet-forest.webp',
        url: '/files/generated.webp',
      },
    ])
    expect(getGeneratedImageFileIds(parts)).toEqual(['file-1'])
    expect(loggerSet).not.toHaveBeenCalled()
  })

  it('normalizes a ready output from a non-default image model', async () => {
    const loggerSet = vi.fn()

    stubGeneratedImageFile(createGeneratedImageFileRow({
      originProvider: 'google',
    }))

    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-2',
        state: 'output-available',
        input: { prompt: 'A quiet forest' },
        output: {
          status: 'ready',
          file: {
            id: 'file-1',
            storageKey: 'generated.webp',
            name: 'quiet-forest.webp',
            size: 123,
            type: 'image/webp',
            source: 'assistant',
            expiresAt: null,
            url: 'javascript:alert(1)',
            downloadUrl: 'https://attacker.example/steal',
          },
          provider: 'google',
          model: 'gemini-3-pro-image',
        },
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'google',
      chatId: 'chat-4',
      userId: 4,
      logger: { set: loggerSet },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'quiet-forest.webp',
        url: '/files/generated.webp',
      },
    ])
    expect(getGeneratedImageFileIds(parts)).toEqual(['file-1'])
  })

  it.each([
    {
      name: 'unowned file ID',
      change: (output: any) => {
        output.file.id = 'other-file'
      },
      row: undefined,
    },
    {
      name: 'mismatched storage key',
      change: (output: any) => {
        output.file.storageKey = 'other.webp'
      },
      row: createGeneratedImageFileRow(),
    },
    {
      name: 'wrong provider',
      change: (output: any) => {
        output.provider = 'google'
        output.model = 'gemini-3.1-flash-image'
      },
      row: createGeneratedImageFileRow(),
    },
    {
      name: 'wrong image model',
      change: (output: any) => {
        output.model = 'gpt-image-1'
      },
      row: createGeneratedImageFileRow(),
    },
    {
      name: 'real image model claimed under the wrong provider',
      change: (output: any) => {
        output.model = 'gemini-3.1-flash-image'
      },
      row: createGeneratedImageFileRow(),
    },
    {
      name: 'non-assistant source',
      change: (output: any) => {
        output.file.source = 'upload'
      },
      row: createGeneratedImageFileRow(),
    },
    {
      name: 'invalid size',
      change: (output: any) => {
        output.file.size = 0
      },
      row: createGeneratedImageFileRow(),
    },
  ])('drops a ready output with $name', async ({ change, row }) => {
    const output = {
      status: 'ready',
      file: {
        id: 'file-1',
        storageKey: 'generated.webp',
        name: 'quiet-forest.webp',
        size: 123,
        type: 'image/webp',
        source: 'assistant',
        url: '/files/generated.webp',
        downloadUrl: '/files/generated.webp?download=1',
      },
      provider: 'openai',
      model: 'gpt-image-2',
    }

    change(output)
    stubGeneratedImageFile(row)

    const parts: UIMessage['parts'] = [{
      type: 'tool-generate_image',
      toolCallId: 'image-forged',
      state: 'output-available',
      input: { prompt: 'A quiet forest' },
      output,
    }] as any
    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'openai',
      chatId: 'chat-forged',
      userId: 3,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual([])
    expect(getGeneratedImageFileIds(
      parts,
      'openai',
      normalizedParts,
    )).toEqual([])
  })

  it.each([
    {
      code: 'storage-quota',
      expected: [
        'Not enough storage space to generate an image.',
        'Delete files in the file manager, then try again.',
      ].join(' '),
    },
    {
      code: 'provider-auth',
      expected: [
        'The image provider rejected the saved API key.',
        'Update the provider key in settings, then try again.',
      ].join(' '),
    },
    {
      code: 'provider-quota-exceeded',
      expected: [
        'The image provider quota has been exceeded.',
        'Check provider billing or use another saved provider key.',
      ].join(' '),
    },
    {
      code: 'provider-rate-limit',
      expected: [
        'Image generation is temporarily rate limited.',
        'Wait a moment, then try again.',
      ].join(' '),
    },
    {
      code: 'provider-unavailable',
      expected: [
        'The image provider is temporarily unavailable.',
        'Try again later or use a different provider.',
      ].join(' '),
    },
    {
      code: 'image-save-failed',
      expected: [
        'The generated image could not be saved.',
        'Try again. If it keeps failing, contact support.',
      ].join(' '),
    },
    {
      code: 'provider-safety',
      expected: [
        'The provider could not generate this image because the request did',
        'not pass its safety checks. Revise the prompt and try again.',
      ].join(' '),
    },
  ])('persists actionable $code guidance from the safe error catalog', async ({
    code,
    expected,
  }) => {
    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-2',
        state: 'output-error',
        input: { prompt: 'A quiet forest' },
        errorText: JSON.stringify({
          code,
          message: 'untrusted provider diagnostic',
          why: 'sk-live-secret',
          fix: 'javascript:alert(1)',
        }),
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'google',
      chatId: 'chat-4',
      userId: 4,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'text',
        text: expected,
      },
    ])
    expect(JSON.stringify(normalizedParts)).not.toContain('sk-live-secret')
    expect(JSON.stringify(normalizedParts)).not.toContain('javascript:')
  })

  it('allows an exact application-owned message without copying details', async () => {
    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-3',
        state: 'output-error',
        input: { prompt: 'A quiet forest' },
        errorText: JSON.stringify({
          code: 'unknown-new-code',
          message: 'Not enough storage space to generate an image.',
          why: 'raw quota diagnostics sk-secret',
        }),
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'openai',
      chatId: 'chat-5',
      userId: 5,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'text',
        text: [
          'Not enough storage space to generate an image.',
          'Delete files in the file manager, then try again.',
        ].join(' '),
      },
    ])
    expect(JSON.stringify(normalizedParts)).not.toContain('sk-secret')
  })

  it.each([
    'raw provider secret diagnostic sk-secret',
    JSON.stringify({
      code: 'untrusted-code',
      message: 'raw provider secret diagnostic sk-secret',
      why: 'javascript:alert(1)',
    }),
  ])('uses generic safe text for an untrusted tool error', async (errorText) => {
    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-4',
        state: 'output-error',
        input: { prompt: 'A quiet forest' },
        errorText,
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'google',
      chatId: 'chat-6',
      userId: 6,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'text',
        text: [
          'Image generation failed.',
          'Revise the prompt or try a different provider.',
        ].join(' '),
      },
    ])
    expect(JSON.stringify(normalizedParts)).not.toContain('sk-secret')
    expect(JSON.stringify(normalizedParts)).not.toContain('javascript:')
  })
})
