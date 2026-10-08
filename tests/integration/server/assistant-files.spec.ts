import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import {
  getGeneratedImageFileIds,
  getModelContextFileStorageKeys,
  normalizeAssistantMessagePartsForPersistence,
  persistGatewayGeneratedImageParts,
  sanitizeMessagesForModelContext,
  stripUndeliveredInlineDataParts,
} from '../../../server/utils/files/assistant-files'
import {
  CARRIED_FILES_MAX_BYTES,
  CARRIED_FILES_MAX_COUNT,
  CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES,
  CARRIED_TEXT_FILE_MAX_BYTES,
  REQUEST_FILES_MAX_BYTES,
} from '../../../server/utils/files/file-governance'
import { createCarriedMediaTypePredicate } from '../../../server/utils/files/carried-media-types'

const mocks = vi.hoisted(() => ({
  persistFile: vi.fn(),
}))

// assistant-files.ts statically imports persistFile for
// persistGatewayGeneratedImageParts. The real persist-file.ts transitively
// imports server/api/v1/storage/index.get.ts, a Nitro route file whose
// module body calls the auto-imported defineEventHandler() at the top
// level — unavailable in this bare (non-Nuxt-environment) test file, so it
// must be mocked out before assistant-files.ts is ever imported for real,
// exactly like tests/integration/server/image-generation.spec.ts already
// does for the same import chain.
vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

function createWebPBytes(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x12, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c,
    0x06, 0x00, 0x00, 0x00,
    0x2f, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ])
}

function buildImageDataUrl(bytes: Uint8Array, mediaType: string): string {
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')

  return `data:${mediaType};base64,${btoa(binary)}`
}

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

  it('strips a persisted image-generation failure notice with a ref '
    + 'suffix from an assistant message before it reaches the model', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-image-failure',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: [
              'The image provider rejected the saved API key.',
              'Update the provider key in settings, then try again.',
              '(ref: cf-ray-abc123)',
            ].join(' '),
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(0)
  })

  it('never replays earlier external search tool outputs to the model',
    () => {
      const messages: UIMessage[] = [
        {
          id: 'assistant-searched',
          role: 'assistant',
          parts: [
            {
              type: 'tool-web_search_brave',
              toolCallId: 'call-1',
              state: 'output-available',
              input: { query: 'q' },
              output: {
                provider: 'brave',
                results: [{
                  title: 'T',
                  url: 'https://example.com',
                  snippet: 'x'.repeat(1500),
                }],
              },
            },
            {
              type: 'source-url',
              sourceId: 'source-1',
              url: 'https://example.com',
            },
            { type: 'text', text: 'Answer from search.' },
          ],
        } as any,
      ]

      const sanitizedMessages = sanitizeMessagesForModelContext(messages)

      expect(sanitizedMessages[0]?.parts).toEqual([
        { type: 'text', text: 'Answer from search.' },
      ])
    })

  it('keeps an assistant message with ordinary text untouched', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-normal-text',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'Here is the summary you asked for.',
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(1)
    expect(sanitizedMessages[0]?.parts).toEqual([
      {
        type: 'text',
        text: 'Here is the summary you asked for.',
      },
    ])
  })

  it('drops an assistant message made only of failure text entirely '
    + 'from model context', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-only-failure',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: [
              'The image provider is temporarily unavailable.',
              'Try again later or use a different provider.',
            ].join(' '),
          },
        ],
      } as any,
      {
        id: 'user-follow-up',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Try again please.',
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(1)
    expect(sanitizedMessages[0]?.id).toBe('user-follow-up')
  })

  it('does not strip the same failure text from a user message', () => {
    const failureText = [
      'The image provider rejected the saved API key.',
      'Update the provider key in settings, then try again.',
    ].join(' ')
    const messages: UIMessage[] = [
      {
        id: 'user-quoting-failure',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: failureText,
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(1)
    expect(sanitizedMessages[0]?.parts).toEqual([
      {
        type: 'text',
        text: failureText,
      },
    ])
  })

  it('strips a persisted gateway generated-image-save failure notice from '
    + 'an assistant message before it reaches the model', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-gateway-image-failure',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'An image was generated but could not be saved.',
          },
        ],
      } as any,
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(sanitizedMessages).toHaveLength(0)
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
        userId: 1,
      },
      attributes: {
        assistantFiles: {
          providerId: 'openai',
        },
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
        url: '/files/generated.webp?generated=1',
      },
    ])
    expect(getGeneratedImageFileIds(parts)).toEqual(['file-1'])
    expect(getGeneratedImageFileIds(
      parts,
      'openai',
      normalizedParts,
    )).toEqual(['file-1'])
    expect(loggerSet).not.toHaveBeenCalled()
  })

  it('drops a redundant failed call once a sibling call succeeded', async () => {
    const loggerSet = vi.fn()

    stubGeneratedImageFile(createGeneratedImageFileRow())

    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-1',
        state: 'output-error',
        input: { prompt: 'A quiet forest' },
        errorText: JSON.stringify({ code: 'generation-busy' }),
      },
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
            url: '/files/generated.webp',
            downloadUrl: '/files/generated.webp?download=1',
          },
          provider: 'openai',
          model: 'gpt-image-2',
        },
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'openai',
      chatId: 'chat-3b',
      userId: 3,
      logger: { set: loggerSet },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'quiet-forest.webp',
        url: '/files/generated.webp?generated=1',
      },
    ])
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
        url: '/files/generated.webp?generated=1',
      },
    ])
    expect(getGeneratedImageFileIds(parts)).toEqual(['file-1'])
  })

  it('normalizes a ready output from the xai image provider', async () => {
    const loggerSet = vi.fn()

    stubGeneratedImageFile(createGeneratedImageFileRow({
      originProvider: 'xai',
    }))

    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-3',
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
          provider: 'xai',
          model: 'grok-imagine-image-2.0',
        },
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'xai',
      chatId: 'chat-5',
      userId: 5,
      logger: { set: loggerSet },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'quiet-forest.webp',
        url: '/files/generated.webp?generated=1',
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
      code: 'provider-model-restricted',
      expected: [
        'Your gateway account can\'t use this model.',
        'Add paid credits to your gateway account, or choose a different',
        'model.',
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
    {
      code: 'generation-busy',
      expected: [
        'Please wait a few seconds before generating another image.',
        'Only one image generates at a time per account, with a short',
        'cooldown between images.',
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

  it('appends a support reference when the error carries a request id', async () => {
    const parts: UIMessage['parts'] = [
      {
        type: 'tool-generate_image',
        toolCallId: 'image-2b',
        state: 'output-error',
        input: { prompt: 'A quiet forest' },
        errorText: JSON.stringify({
          code: 'provider-auth',
          message: 'untrusted provider diagnostic',
          requestId: 'cf-ray-abc123',
        }),
      },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'google',
      chatId: 'chat-4b',
      userId: 4,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual([
      {
        type: 'text',
        text: [
          'The image provider rejected the saved API key.',
          'Update the provider key in settings, then try again.',
          '(ref: cf-ray-abc123)',
        ].join(' '),
      },
    ])
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

  it('persists a visible error when a stream-level provider failure '
    + 'leaves no other content, for a turn that requested image '
    + 'generation', async () => {
    const logger = { set: vi.fn() }
    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts: [],
      providerId: 'xai',
      chatId: 'chat-7',
      userId: 7,
      logger,
      requestedTools: ['image_generation'],
      streamErrorText: JSON.stringify({
        code: 'provider-auth',
        message: 'untrusted provider diagnostic',
      }),
    })

    expect(normalizedParts).toEqual([
      {
        type: 'text',
        text: [
          'The image provider rejected the saved API key.',
          'Update the provider key in settings, then try again.',
        ].join(' '),
      },
    ])
    expect(logger.set).toHaveBeenCalledWith({
      imageGeneration: {
        status: 'failed',
      },
      attributes: {
        imageGeneration: {
          provider: 'xai',
          errorCode: 'image-generation-stream-error',
        },
      },
    })
  })

  it('leaves empty parts empty when no image generation was requested, '
    + 'even if a stream error occurred', async () => {
    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts: [],
      providerId: 'openai',
      chatId: 'chat-8',
      userId: 8,
      logger: { set: vi.fn() },
      requestedTools: ['web_search'],
      streamErrorText: JSON.stringify({ code: 'provider-auth' }),
    })

    expect(normalizedParts).toEqual([])
  })

  it('leaves already-meaningful parts untouched even when a stream error '
    + 'was also observed', async () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Partial answer before the failure.' },
    ] as any

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts,
      providerId: 'xai',
      chatId: 'chat-9',
      userId: 9,
      logger: { set: vi.fn() },
      requestedTools: ['image_generation'],
      streamErrorText: JSON.stringify({ code: 'provider-auth' }),
    })

    expect(normalizedParts).toEqual(parts)
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

describe('persistGatewayGeneratedImageParts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    mocks.persistFile.mockReset()
  })

  it('uploads an inline data: URL image part to R2 and rewrites it to a '
    + '/files/ URL, tracking the persisted file id', async () => {
    mocks.persistFile.mockResolvedValue({
      id: 'file-42',
      storageKey: 'generated-42.webp',
      name: 'generated-image-1.webp',
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    })

    const parts: UIMessage['parts'] = [
      {
        type: 'file',
        mediaType: 'image/webp',
        url: buildImageDataUrl(createWebPBytes(), 'image/webp'),
      },
      {
        type: 'text',
        text: 'Here is your generated image.',
      },
    ] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-1',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: vi.fn() },
    })

    expect(result.fileIds).toEqual(['file-42'])
    expect(result.parts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'generated-image-1.webp',
        url: '/files/generated-42.webp?generated=1',
      },
      {
        type: 'text',
        text: 'Here is your generated image.',
      },
    ])
    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      mediaType: 'image/webp',
      source: 'assistant',
      originProvider: 'openrouter',
      originModel: 'openai/gpt-5-image',
    }))
  })

  it('uploads a reasoning-file part carrying an inline data: image URL '
    + 'the same way as a plain file part — Gemini via the Vercel gateway '
    + 'narrates image generation this way when reasoning is enabled',
  async () => {
    mocks.persistFile.mockResolvedValue({
      id: 'file-43',
      storageKey: 'generated-43.webp',
      name: 'generated-image-2.webp',
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    })

    const parts: UIMessage['parts'] = [
      {
        type: 'reasoning-file',
        mediaType: 'image/webp',
        url: buildImageDataUrl(createWebPBytes(), 'image/webp'),
      },
    ] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-reasoning-1',
      gatewayId: 'vercel-gateway',
      modelId: 'google/gemini-3.1-flash-image-preview',
      logger: { set: vi.fn() },
    })

    expect(result.fileIds).toEqual(['file-43'])
    expect(result.parts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'generated-image-2.webp',
        url: '/files/generated-43.webp?generated=1',
      },
    ])
    expect(JSON.stringify(result.parts)).not.toContain('data:')
  })

  it('drops every reasoning-file thought image and keeps the real file '
    + 'image as the answer, without spending the per-message cap on '
    + 'thoughts, whatever order they arrive in', async () => {
    mocks.persistFile.mockResolvedValue({
      id: 'file-final',
      storageKey: 'generated-final.webp',
      name: 'generated-image-final.webp',
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    })

    const thoughtImageUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const finalImageUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const parts: UIMessage['parts'] = [
      { type: 'reasoning-file', mediaType: 'image/webp', url: thoughtImageUrl },
      { type: 'reasoning-file', mediaType: 'image/webp', url: thoughtImageUrl },
      { type: 'file', mediaType: 'image/webp', url: finalImageUrl },
      { type: 'reasoning-file', mediaType: 'image/webp', url: thoughtImageUrl },
      { type: 'reasoning-file', mediaType: 'image/webp', url: thoughtImageUrl },
    ] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-thoughts-1',
      gatewayId: 'vercel-gateway',
      modelId: 'google/gemini-3.1-flash-image-preview',
      logger: { set: vi.fn() },
    })

    expect(mocks.persistFile).toHaveBeenCalledTimes(1)
    expect(result.fileIds).toEqual(['file-final'])
    expect(result.parts).toEqual([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'generated-image-final.webp',
        url: '/files/generated-final.webp?generated=1',
      },
    ])
    expect(JSON.stringify(result.parts)).not.toContain('data:')
  })

  it('does not let thought images exhaust the per-message cap before the '
    + 'real image is processed', async () => {
    mocks.persistFile.mockImplementation(async (input: any) => ({
      id: `file-${input.originModel}`,
      storageKey: `${input.originModel}.webp`,
      name: input.fileName,
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    }))

    const imageUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const thoughtParts: UIMessage['parts'] = Array.from(
      { length: 4 },
      () => ({ type: 'reasoning-file', mediaType: 'image/webp', url: imageUrl }),
    ) as any
    const parts: UIMessage['parts'] = [
      ...thoughtParts,
      { type: 'file', mediaType: 'image/webp', url: imageUrl },
    ] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-thoughts-2',
      gatewayId: 'vercel-gateway',
      modelId: 'google/gemini-3.1-flash-image-preview',
      logger: { set: vi.fn() },
    })

    expect(mocks.persistFile).toHaveBeenCalledTimes(1)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]?.type).toBe('file')
    expect(result.fileIds).toHaveLength(1)
  })

  it('promotes the last of several reasoning-file thought images to the '
    + 'delivered answer when no real file image was ever surfaced', async () => {
    mocks.persistFile.mockImplementation(async (input: any) => ({
      id: `file-${input.originModel}`,
      storageKey: `${input.originModel}.webp`,
      name: input.fileName,
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    }))

    const firstThoughtUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const lastThoughtUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const parts: UIMessage['parts'] = [
      { type: 'reasoning-file', mediaType: 'image/webp', url: firstThoughtUrl },
      { type: 'reasoning-file', mediaType: 'image/webp', url: lastThoughtUrl },
    ] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-thoughts-3',
      gatewayId: 'vercel-gateway',
      modelId: 'google/gemini-3.1-flash-image-preview',
      logger: { set: vi.fn() },
    })

    expect(mocks.persistFile).toHaveBeenCalledTimes(1)
    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      fileData: expect.anything(),
    }))
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]?.type).toBe('file')
    expect(JSON.stringify(result.parts)).not.toContain('data:')
  })

  it('leaves parts untouched when the response has no gateway image parts',
    async () => {
      const parts: UIMessage['parts'] = [
        { type: 'text', text: 'Just text, no image.' },
      ] as any

      const result = await persistGatewayGeneratedImageParts({
        parts,
        userId: 7,
        chatId: 'chat-gateway-2',
        gatewayId: 'vercel-gateway',
        modelId: 'google/gemini-3.1-flash-image-preview',
        logger: { set: vi.fn() },
      })

      expect(result.parts).toEqual(parts)
      expect(result.fileIds).toEqual([])
      expect(mocks.persistFile).not.toHaveBeenCalled()
    })

  it('replaces a malformed inline image with a failure text part instead '
    + 'of throwing', async () => {
    const parts: UIMessage['parts'] = [{
      type: 'file',
      mediaType: 'image/webp',
      url: 'data:image/webp;base64,bm90LWFuLWltYWdl',
    }] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-3',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: vi.fn() },
    })

    expect(result.parts).toEqual([{
      type: 'text',
      text: 'An image was generated but could not be saved.',
    }])
    expect(result.fileIds).toEqual([])
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('replaces the part with a failure text and logs when persistFile '
    + 'rejects (e.g. storage quota exceeded)', async () => {
    const loggerSet = vi.fn()

    mocks.persistFile.mockRejectedValue(new Error('quota exceeded'))

    const parts: UIMessage['parts'] = [{
      type: 'file',
      mediaType: 'image/webp',
      url: buildImageDataUrl(createWebPBytes(), 'image/webp'),
    }] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-4',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: loggerSet },
    })

    expect(result.parts).toEqual([{
      type: 'text',
      text: 'An image was generated but could not be saved.',
    }])
    expect(result.fileIds).toEqual([])
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      assistantFiles: expect.objectContaining({
        action: 'gateway-image-persist-failed',
        chatId: 'chat-gateway-4',
        userId: 7,
      }),
      attributes: {
        assistantFiles: {
          providerId: 'openrouter',
          error: 'quota exceeded',
        },
      },
    }))
  })

  it('ignores a non-image file part, e.g. one already persisted as a '
    + '/files/ URL', async () => {
    const parts: UIMessage['parts'] = [{
      type: 'file',
      mediaType: 'application/pdf',
      filename: 'notes.pdf',
      url: '/files/notes.pdf',
    }] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-5',
      gatewayId: 'vercel-gateway',
      modelId: 'anthropic/claude-opus-5',
      logger: { set: vi.fn() },
    })

    expect(result.parts).toEqual(parts)
    expect(result.fileIds).toEqual([])
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('rejects an inline image whose base64 payload exceeds the size bound '
    + 'before ever calling atob(), instead of decoding it first', async () => {
    const oversizedBase64 = 'A'.repeat(15 * 1024 * 1024)

    const parts: UIMessage['parts'] = [{
      type: 'file',
      mediaType: 'image/webp',
      url: `data:image/webp;base64,${oversizedBase64}`,
    }] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-6',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: vi.fn() },
    })

    expect(result.parts).toEqual([{
      type: 'text',
      text: 'An image was generated but could not be saved.',
    }])
    expect(result.fileIds).toEqual([])
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('caps the number of inline images persisted from a single response, '
    + 'so one turn cannot force unbounded decode/R2-write work', async () => {
    mocks.persistFile.mockImplementation(async (input: any) => ({
      id: `file-${input.originModel}`,
      storageKey: `${input.originModel}.webp`,
      name: input.fileName,
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    }))

    const imageUrl = buildImageDataUrl(createWebPBytes(), 'image/webp')
    const parts: UIMessage['parts'] = Array.from({ length: 6 }, () => ({
      type: 'file',
      mediaType: 'image/webp',
      url: imageUrl,
    })) as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-7',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: vi.fn() },
    })

    expect(mocks.persistFile).toHaveBeenCalledTimes(4)
    expect(result.fileIds).toHaveLength(4)

    const failureParts = result.parts.filter((part) => {
      return part.type === 'text'
        && part.text === 'An image was generated but could not be saved.'
    })

    expect(failureParts).toHaveLength(2)
  })

  it('replaces a non-image inline data: URL part with a failure text '
    + 'placeholder instead of persisting the raw blob into messages.parts',
  async () => {
    const parts: UIMessage['parts'] = [{
      type: 'file',
      mediaType: 'audio/mpeg',
      url: 'data:audio/mpeg;base64,bm90LWFuLWltYWdl',
    }] as any

    const result = await persistGatewayGeneratedImageParts({
      parts,
      userId: 7,
      chatId: 'chat-gateway-8',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-5-image',
      logger: { set: vi.fn() },
    })

    expect(result.parts).toEqual([{
      type: 'text',
      text: 'The model returned a file this app does not yet support saving.',
    }])
    expect(result.fileIds).toEqual([])
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })
})

describe('stripUndeliveredInlineDataParts', () => {
  it('replaces a reasoning-file part carrying an inline data: image URL '
    + 'with the same image-persist failure text used elsewhere, keeping '
    + 'the rest of the message intact, and logs the replacement', () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Here is your image.' },
      {
        type: 'reasoning-file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,aGVsbG8=',
      },
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'result.png',
        url: '/files/result.png?generated=1',
      },
    ] as any

    const strippedParts = stripUndeliveredInlineDataParts(
      parts,
      { set: loggerSet },
    )

    expect(strippedParts).toEqual([
      { type: 'text', text: 'Here is your image.' },
      {
        type: 'text',
        text: 'An image was generated but could not be saved.',
      },
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'result.png',
        url: '/files/result.png?generated=1',
      },
    ])
    expect(loggerSet).toHaveBeenCalledWith({
      assistantFiles: {
        action: 'undelivered-inline-data-part-replaced',
        count: 1,
      },
    })
  })

  it('replaces a non-image inline data: URL part with the generic '
    + 'unsupported-file text', () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [{
      type: 'reasoning-file',
      mediaType: 'audio/mpeg',
      url: 'data:audio/mpeg;base64,aGVsbG8=',
    }] as any

    const strippedParts = stripUndeliveredInlineDataParts(
      parts,
      { set: loggerSet },
    )

    expect(strippedParts).toEqual([{
      type: 'text',
      text: 'The model returned a file this app does not yet support saving.',
    }])
  })

  it('leaves parts untouched and logs nothing when nothing carries an '
    + 'inline data: URL and the message is well within the size bound', () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Ordinary answer.' },
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'result.png',
        url: '/files/result.png?generated=1',
      },
    ] as any

    const strippedParts = stripUndeliveredInlineDataParts(
      parts,
      { set: loggerSet },
    )

    expect(strippedParts).toEqual(parts)
    expect(loggerSet).not.toHaveBeenCalled()
  })

  it('replaces the whole message with the fixed oversized-response notice '
    + 'when the remaining parts still exceed the size bound after replacing '
    + 'inline data: parts', () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'A'.repeat(1_600_000) },
    ] as any

    const strippedParts = stripUndeliveredInlineDataParts(
      parts,
      { set: loggerSet },
    )

    expect(strippedParts).toEqual([{
      type: 'text',
      text: 'The response was too large to save. Try again or pick '
        + 'another model.',
    }])
    expect(loggerSet).toHaveBeenCalledWith({
      assistantFiles: {
        action: 'oversized-assistant-parts-replaced',
        estimatedBytes: expect.any(Number),
      },
      attributes: {
        assistantPersist: {
          oversizedBreakdown: { text: expect.any(Number) },
        },
      },
    })
  })

  it('logs both an inline-data replacement and an oversized replacement '
    + 'when a single response hits both guards', () => {
    const loggerSet = vi.fn()
    const parts: UIMessage['parts'] = [
      {
        type: 'reasoning-file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,aGVsbG8=',
      },
      { type: 'text', text: 'A'.repeat(1_600_000) },
    ] as any

    const strippedParts = stripUndeliveredInlineDataParts(
      parts,
      { set: loggerSet },
    )

    expect(strippedParts).toEqual([{
      type: 'text',
      text: 'The response was too large to save. Try again or pick '
        + 'another model.',
    }])
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      assistantFiles: expect.objectContaining({
        action: 'undelivered-inline-data-part-replaced',
        count: 1,
      }),
    }))
    expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      assistantFiles: expect.objectContaining({
        action: 'oversized-assistant-parts-replaced',
      }),
      attributes: {
        assistantPersist: {
          oversizedBreakdown: { text: expect.any(Number) },
        },
      },
    }))
  })
})

describe('sanitizeMessagesForModelContext file carry-over', () => {
  const oneKilobyte = 1024
  const allowAnyMediaType = () => true
  const omittedFileTextPrefix
    = 'Previously attached file omitted from model context: '

  function createUserMessage(id: string, fileNames: string[]): UIMessage {
    return {
      id,
      role: 'user',
      parts: [
        { type: 'text', text: `message ${id}` },
        ...fileNames.map((fileName) => {
          return {
            type: 'file',
            mediaType: 'application/pdf',
            filename: fileName,
            url: `/files/${fileName}`,
          }
        }),
      ],
    } as UIMessage
  }

  function createAssistantMessage(id: string): UIMessage {
    return {
      id,
      role: 'assistant',
      parts: [{ type: 'text', text: `answer ${id}` }],
    } as UIMessage
  }

  function createConversation(userMessages: UIMessage[]): UIMessage[] {
    return userMessages.flatMap((message, index) => {
      if (index === userMessages.length - 1) {
        return [message]
      }

      return [message, createAssistantMessage(`assistant-${index}`)]
    })
  }

  function createSizes(
    entries: Record<string, number>,
  ): ReadonlyMap<string, number> {
    return new Map(Object.entries(entries))
  }

  function getKeptFileNames(message: UIMessage | undefined): string[] {
    return (message?.parts ?? []).flatMap((part) => {
      return part.type === 'file' && part.filename ? [part.filename] : []
    })
  }

  function getOmittedFileNames(message: UIMessage | undefined): string[] {
    return (message?.parts ?? []).flatMap((part) => {
      if (
        part.type !== 'text'
        || !part.text.startsWith(omittedFileTextPrefix)
      ) {
        return []
      }

      return [part.text.slice(omittedFileTextPrefix.length, -1)]
    })
  }

  function findMessage(
    messages: UIMessage[],
    id: string,
  ): UIMessage | undefined {
    return messages.find(message => message.id === id)
  }

  it('omits earlier user files when no sizes map is provided', () => {
    const messages = createConversation([
      createUserMessage('user-1', ['old.pdf']),
      createUserMessage('user-2', ['latest.pdf']),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages)

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'user-1')))
      .toEqual([])
    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'user-1')))
      .toEqual(['old.pdf'])
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'user-2')))
      .toEqual(['latest.pdf'])
  })

  it('omits earlier user files when the sizes map is empty', () => {
    const messages = createConversation([
      createUserMessage('user-1', ['old.pdf']),
      createUserMessage('user-2', ['latest.pdf']),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: new Map(),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'user-1')))
      .toEqual(['old.pdf'])
  })

  it('keeps a file from the previous user message within the budget', () => {
    const messages = createConversation([
      createUserMessage('user-1', ['old.pdf']),
      createUserMessage('user-2', ['latest.pdf']),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'old.pdf': oneKilobyte,
        'latest.pdf': oneKilobyte,
      }),
    })
    const previousUserMessage = findMessage(sanitizedMessages, 'user-1')

    expect(previousUserMessage?.parts).toEqual([
      { type: 'text', text: 'message user-1' },
      {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'old.pdf',
        url: '/files/old.pdf',
      },
    ])
  })

  it('omits a file older than the carry-over window even when it fits', () => {
    const windowSize = CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES
    const earlierMessages = Array.from(
      { length: windowSize + 1 },
      (_unused, index) => {
        return createUserMessage(`user-${index}`, [`file-${index}.pdf`])
      },
    )
    const messages = createConversation([
      ...earlierMessages,
      createUserMessage('latest', []),
    ])
    const fileSizesByStorageKey = createSizes(
      Object.fromEntries(
        earlierMessages.map((_message, index) => {
          return [`file-${index}.pdf`, oneKilobyte]
        }),
      ),
    )

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey,
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'user-0')))
      .toEqual(['file-0.pdf'])

    for (let index = 1; index <= windowSize; index += 1) {
      expect(
        getKeptFileNames(findMessage(sanitizedMessages, `user-${index}`)),
      ).toEqual([`file-${index}.pdf`])
    }
  })

  it('counts earlier user messages without files toward the window', () => {
    const windowSize = CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES
    const textOnlyMessages = Array.from(
      { length: windowSize },
      (_unused, index) => createUserMessage(`text-${index}`, []),
    )
    const messages = createConversation([
      createUserMessage('with-file', ['old.pdf']),
      ...textOnlyMessages,
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({ 'old.pdf': oneKilobyte }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'with-file')))
      .toEqual(['old.pdf'])
  })

  it('stops carrying files once the cumulative byte budget is spent, '
    + 'newest first, while a smaller older file that still fits is kept', () => {
    const messages = createConversation([
      createUserMessage('oldest', ['small.pdf']),
      createUserMessage('middle', ['medium.pdf']),
      createUserMessage('newest', ['large.pdf']),
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'large.pdf': CARRIED_FILES_MAX_BYTES - oneKilobyte,
        'medium.pdf': 2 * oneKilobyte,
        'small.pdf': oneKilobyte,
      }),
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'newest')))
      .toEqual(['large.pdf'])
    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'middle')))
      .toEqual(['medium.pdf'])
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'oldest')))
      .toEqual(['small.pdf'])
  })

  it('omits a single earlier file larger than the carried byte budget', () => {
    const messages = createConversation([
      createUserMessage('earlier', ['huge.pdf']),
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'huge.pdf': CARRIED_FILES_MAX_BYTES + 1,
      }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['huge.pdf'])
  })

  it('carries only the newest files up to the count cap', () => {
    const filesPerMessage = CARRIED_FILES_MAX_COUNT / 2
    const createFileNames = (prefix: string) => {
      return Array.from({ length: filesPerMessage }, (_unused, index) => {
        return `${prefix}-${index}.png`
      })
    }
    const oldestFileNames = createFileNames('oldest')
    const middleFileNames = createFileNames('middle')
    const newestFileNames = createFileNames('newest')
    const messages = createConversation([
      createUserMessage('oldest', oldestFileNames),
      createUserMessage('middle', middleFileNames),
      createUserMessage('newest', newestFileNames),
      createUserMessage('latest', []),
    ])
    const fileSizesByStorageKey = createSizes(
      Object.fromEntries(
        [...oldestFileNames, ...middleFileNames, ...newestFileNames].map(
          fileName => [fileName, oneKilobyte],
        ),
      ),
    )

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey,
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'newest')))
      .toEqual(newestFileNames)
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'middle')))
      .toEqual(middleFileNames)
    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'oldest')))
      .toEqual(oldestFileNames)
  })

  it('shrinks the carried budget by the size of the latest message files',
    () => {
      const remainingBytes = oneKilobyte * oneKilobyte
      const messages = createConversation([
        createUserMessage('earlier', ['fits.pdf', 'overflows.pdf']),
        createUserMessage('latest', ['heavy.pdf']),
      ])

      const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
        canCarryMediaType: allowAnyMediaType,
        fileSizesByStorageKey: createSizes({
          'heavy.pdf': REQUEST_FILES_MAX_BYTES - remainingBytes,
          'fits.pdf': remainingBytes,
          'overflows.pdf': 1,
        }),
      })

      expect(getKeptFileNames(findMessage(sanitizedMessages, 'earlier')))
        .toEqual(['fits.pdf'])
      expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
        .toEqual(['overflows.pdf'])
      expect(getKeptFileNames(findMessage(sanitizedMessages, 'latest')))
        .toEqual(['heavy.pdf'])
    })

  it('carries nothing when the latest message files use the whole request '
    + 'budget', () => {
    const messages = createConversation([
      createUserMessage('earlier', ['small.pdf']),
      createUserMessage('latest', ['heavy.pdf']),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'small.pdf': 1,
        'heavy.pdf': REQUEST_FILES_MAX_BYTES + oneKilobyte,
      }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['small.pdf'])
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'latest')))
      .toEqual(['heavy.pdf'])
  })

  it('omits an earlier file whose size is unknown', () => {
    const messages = createConversation([
      createUserMessage('earlier', ['known.pdf', 'unknown.pdf']),
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({ 'known.pdf': oneKilobyte }),
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['known.pdf'])
    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['unknown.pdf'])
  })

  it('omits earlier data: URL and non-local file parts', () => {
    const messages = createConversation([
      {
        id: 'earlier',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'inline.txt',
            url: 'data:text/plain;base64,SGVsbG8=',
          },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'remote.png',
            url: 'https://example.com/files/remote.png',
          },
        ],
      } as UIMessage,
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({ 'remote.png': oneKilobyte }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['inline.txt', 'remote.png'])
  })

  it('always keeps latest user message files regardless of size', () => {
    const messages = createConversation([
      createUserMessage('latest', ['known.pdf', 'unknown.pdf']),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'known.pdf': REQUEST_FILES_MAX_BYTES * 4,
      }),
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'latest')))
      .toEqual(['known.pdf', 'unknown.pdf'])
  })

  it('keeps carrying text and assistant handling unchanged', () => {
    const messages: UIMessage[] = [
      createUserMessage('earlier', ['old.pdf']),
      {
        id: 'assistant-file',
        role: 'assistant',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'chart.png',
            url: '/files/chart.png',
          },
        ],
      } as UIMessage,
      createUserMessage('latest', []),
    ]

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'old.pdf': oneKilobyte,
        'chart.png': oneKilobyte,
      }),
    })

    expect(findMessage(sanitizedMessages, 'assistant-file')?.parts).toEqual([
      {
        type: 'text',
        text: 'Generated file saved in the user file library: chart.png (image/png).',
      },
    ])
  })

  it('omits earlier files whose media type the predicate rejects while '
    + 'carrying the ones it accepts', () => {
    const messages = createConversation([
      {
        id: 'earlier',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'picture.png',
            url: '/files/picture.png',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'report.pdf',
            url: '/files/report.pdf',
          },
        ],
      } as UIMessage,
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: createCarriedMediaTypePredicate(['text', 'pdf']),
      fileSizesByStorageKey: createSizes({
        'picture.png': oneKilobyte,
        'report.pdf': oneKilobyte,
      }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['picture.png'])
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['report.pdf'])
  })

  it('carries nothing without a media type predicate even when sizes are '
    + 'known', () => {
    const messages = createConversation([
      createUserMessage('earlier', ['old.pdf']),
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      fileSizesByStorageKey: createSizes({ 'old.pdf': oneKilobyte }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['old.pdf'])
  })

  it('omits a carried text file above the text size cap and keeps one at '
    + 'or below it', () => {
    const createTextMessage = (id: string, fileName: string) => ({
      id,
      role: 'user',
      parts: [{
        type: 'file',
        mediaType: 'text/plain; charset=utf-8',
        filename: fileName,
        url: `/files/${fileName}`,
      }],
    }) as UIMessage
    const messages = createConversation([
      createTextMessage('large', 'large.txt'),
      createTextMessage('small', 'small.txt'),
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'large.txt': CARRIED_TEXT_FILE_MAX_BYTES + 1,
        'small.txt': CARRIED_TEXT_FILE_MAX_BYTES,
      }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'large')))
      .toEqual(['large.txt'])
    expect(getKeptFileNames(findMessage(sanitizedMessages, 'small')))
      .toEqual(['small.txt'])
  })

  it('does not spend carried budget on a skipped oversized text file', () => {
    const messages = createConversation([
      createUserMessage('earlier', ['next.pdf']),
      {
        id: 'text',
        role: 'user',
        parts: [{
          type: 'file',
          mediaType: 'text/plain',
          filename: 'huge.txt',
          url: '/files/huge.txt',
        }],
      } as UIMessage,
      createUserMessage('latest', []),
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'huge.txt': CARRIED_FILES_MAX_BYTES,
        'next.pdf': CARRIED_FILES_MAX_BYTES,
      }),
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['next.pdf'])
  })

  it('counts a latest-message data: URL against the request budget', () => {
    const remainingBytes = oneKilobyte
    const payloadBytes = REQUEST_FILES_MAX_BYTES - remainingBytes
    const base64Payload = 'A'.repeat(Math.ceil(payloadBytes * 4 / 3))
    const messages = createConversation([
      createUserMessage('earlier', ['fits.pdf', 'overflows.pdf']),
      {
        id: 'latest',
        role: 'user',
        parts: [{
          type: 'file',
          mediaType: 'image/png',
          filename: 'pasted.png',
          url: `data:image/png;base64,${base64Payload}`,
        }],
      } as UIMessage,
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({
        'fits.pdf': remainingBytes - 4,
        'overflows.pdf': oneKilobyte,
      }),
    })

    expect(getKeptFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['fits.pdf'])
    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['overflows.pdf'])
  })

  it('estimates a non-base64 latest-message data: URL from its payload '
    + 'length', () => {
    const payload = 'x'.repeat(REQUEST_FILES_MAX_BYTES)
    const messages = createConversation([
      createUserMessage('earlier', ['old.pdf']),
      {
        id: 'latest',
        role: 'user',
        parts: [{
          type: 'file',
          mediaType: 'text/plain',
          filename: 'inline.txt',
          url: `data:text/plain,${payload}`,
        }],
      } as UIMessage,
    ])

    const sanitizedMessages = sanitizeMessagesForModelContext(messages, {
      canCarryMediaType: allowAnyMediaType,
      fileSizesByStorageKey: createSizes({ 'old.pdf': 1 }),
    })

    expect(getOmittedFileNames(findMessage(sanitizedMessages, 'earlier')))
      .toEqual(['old.pdf'])
  })

  describe('createCarriedMediaTypePredicate', () => {
    it.each([
      ['text/plain', ['text'], true],
      ['text/markdown; charset=utf-8', ['text'], true],
      ['image/png', ['text', 'image'], true],
      ['image/png', ['text'], false],
      ['application/pdf', ['text', 'pdf'], true],
      ['application/pdf', ['text', 'image'], false],
      ['audio/mpeg', ['text', 'audio'], false],
      ['video/mp4', ['text', 'video'], false],
      ['application/zip', ['text', 'image', 'pdf'], false],
    ])('for %s with input %j returns %s', (mediaType, modalities, expected) => {
      const canCarry = createCarriedMediaTypePredicate(modalities)

      expect(canCarry(mediaType)).toBe(expected)
    })
  })

  describe('getModelContextFileStorageKeys', () => {
    it('returns latest and windowed earlier keys without duplicates', () => {
      const windowSize = CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES
      const earlierMessages = Array.from(
        { length: windowSize + 2 },
        (_unused, index) => {
          return createUserMessage(`user-${index}`, [`file-${index}.pdf`])
        },
      )
      const messages = createConversation([
        ...earlierMessages,
        createUserMessage('latest', ['latest.pdf', 'file-4.pdf']),
      ])

      const storageKeys = getModelContextFileStorageKeys(messages)

      expect(storageKeys).toHaveLength(windowSize + 1)
      expect(new Set(storageKeys)).toEqual(new Set([
        'latest.pdf',
        'file-4.pdf',
        'file-3.pdf',
        'file-2.pdf',
      ]))
    })

    it('skips assistant files, data: URLs and non-local URLs', () => {
      const messages: UIMessage[] = [
        {
          id: 'assistant-file',
          role: 'assistant',
          parts: [
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'chart.png',
              url: '/files/chart.png',
            },
          ],
        } as UIMessage,
        {
          id: 'earlier',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType: 'text/plain',
              filename: 'inline.txt',
              url: 'data:text/plain;base64,SGVsbG8=',
            },
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'remote.png',
              url: 'https://example.com/files/remote.png',
            },
            {
              type: 'file',
              mediaType: 'application/pdf',
              filename: 'owned.pdf',
              url: '/files/owned.pdf?download=1',
            },
          ],
        } as UIMessage,
        createUserMessage('latest', []),
      ]

      expect(getModelContextFileStorageKeys(messages)).toEqual(['owned.pdf'])
    })

    it('returns no keys without a user message', () => {
      expect(getModelContextFileStorageKeys([
        createAssistantMessage('assistant-only'),
      ])).toEqual([])
    })
  })
})
