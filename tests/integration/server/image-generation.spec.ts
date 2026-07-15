import type { ImageModel, UIMessage } from 'ai'
import type { ImageGenerationToolOutput } from '#shared/types/image-generation.d'
import {
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  toUIMessageStream,
} from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImageGenerationTool,
  MAX_GENERATED_IMAGE_BYTES,
  validateGeneratedImage,
} from '../../../server/utils/ai/image-generation'
import { normalizeChatError } from '../../../server/utils/chats/errors'
import {
  normalizeAssistantMessagePartsForPersistence,
} from '../../../server/utils/files/assistant-files'

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
  persistFile: vi.fn(),
  acquireImageGenerationLease: vi.fn(),
  releaseImageGenerationLease: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    generateImage: mocks.generateImage,
  }
})

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: mocks.getEffectiveUserFilePolicy,
  getUserStorageUsageBytes: mocks.getUserStorageUsageBytes,
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

vi.mock('~~/server/utils/ai/image-generation-lock', () => ({
  acquireImageGenerationLease: mocks.acquireImageGenerationLease,
  releaseImageGenerationLease: mocks.releaseImageGenerationLease,
}))

function createPolicy(maxStorageBytes: number) {
  return {
    tier: 'free' as const,
    maxStorageBytes,
    maxFilesPerMessage: 10,
    maxMessageFilesBytes: 1000 * 1024 * 1024,
    fileRetentionDays: 30,
    imageTransformLimitTotal: 0,
    imageTransformUsedTotal: 0,
  }
}

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

function createToolCallingLanguageModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {
            type: 'tool-call' as const,
            toolCallId: 'tool-1',
            toolName: 'generate_image',
            input: JSON.stringify({
              prompt: 'A quiet forest at dawn',
              aspectRatio: '1:1',
              fileName: 'Quiet forest',
            }),
          },
          {
            type: 'finish' as const,
            finishReason: {
              unified: 'tool-calls' as const,
              raw: undefined,
            },
            usage: {
              inputTokens: {
                total: 12,
                noCache: 12,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 8,
                text: 0,
                reasoning: undefined,
              },
            },
          },
        ],
      }),
    }),
  })
}

async function runImageToolThroughAIStream() {
  const imageTool = createImageGenerationTool({
    userId: 1,
    provider: 'openai',
    model: 'gpt-image-2',
    imageModel: {} as ImageModel,
    logger: { set: vi.fn() },
  })
  const result = streamText({
    model: createToolCallingLanguageModel(),
    prompt: 'Create an image of a quiet forest at dawn.',
    tools: {
      generate_image: imageTool,
    },
    toolChoice: {
      type: 'tool',
      toolName: 'generate_image',
    },
  })
  const uiMessageStream = toUIMessageStream({
    stream: result.stream,
    generateMessageId: () => 'assistant-1',
    onError(error) {
      return JSON.stringify(normalizeChatError({
        error,
        providerId: 'openai',
      }))
    },
  })
  const [chunkStream, messageStream] = uiMessageStream.tee()
  const chunksPromise = (async () => {
    const chunks = []

    for await (const chunk of chunkStream) {
      chunks.push(chunk)
    }

    return chunks
  })()
  const messagePromise = (async () => {
    let message: UIMessage | undefined

    for await (const streamedMessage of readUIMessageStream<UIMessage>({
      stream: messageStream,
    })) {
      message = streamedMessage
    }

    return message
  })()
  const [chunks, message] = await Promise.all([
    chunksPromise,
    messagePromise,
  ])

  return { chunks, message }
}

async function executeTool(
  provider: 'openai' | 'google',
  aspectRatio: '1:1' | '3:2' = '1:1',
): Promise<ImageGenerationToolOutput[]> {
  const imageTool = createImageGenerationTool({
    userId: 1,
    provider,
    model: provider === 'openai'
      ? 'gpt-image-2'
      : 'gemini-3.1-flash-image',
    imageModel: {} as ImageModel,
    logger: { set: vi.fn() },
  })
  const execution = imageTool.execute?.(
    {
      prompt: 'A quiet forest at dawn',
      aspectRatio,
      fileName: 'Quiet forest',
    },
    {
      toolCallId: 'tool-1',
      messages: [],
      abortSignal: undefined,
    },
  ) as AsyncIterable<ImageGenerationToolOutput>
  const outputs: ImageGenerationToolOutput[] = []

  for await (const output of execution) {
    outputs.push(output)
  }

  return outputs
}

describe('AI image generation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findFirst: vi.fn(async () => ({
            id: 'file-1',
            storageKey: 'generated.webp',
            name: 'quiet-forest.webp',
            size: 26,
            type: 'image/webp',
            source: 'assistant',
            originProvider: 'openai',
          })),
        },
      },
    }))
    mocks.getEffectiveUserFilePolicy.mockResolvedValue(
      createPolicy(20 * 1024 * 1024),
    )
    mocks.getUserStorageUsageBytes.mockResolvedValue(0)
    mocks.acquireImageGenerationLease.mockResolvedValue({
      userId: 1,
      token: 'lease-token',
    })
    mocks.releaseImageGenerationLease.mockResolvedValue(true)
    mocks.generateImage.mockResolvedValue({
      image: {
        uint8Array: createWebPBytes(),
        mediaType: 'image/webp',
      },
      warnings: [],
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
    })
    mocks.persistFile.mockResolvedValue({
      id: 'file-1',
      storageKey: 'generated.webp',
      name: 'quiet-forest.webp',
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    })
  })

  it('streams phases and persists one OpenAI image without retries', async () => {
    const outputs = await executeTool('openai', '3:2')

    expect(outputs).toEqual([
      { status: 'generating' },
      { status: 'saving' },
      {
        status: 'ready',
        file: {
          id: 'file-1',
          storageKey: 'generated.webp',
          name: 'quiet-forest.webp',
          size: 26,
          type: 'image/webp',
          source: 'assistant',
          url: '/files/generated.webp',
          downloadUrl: '/files/generated.webp?download=1',
        },
        provider: 'openai',
        model: 'gpt-image-2',
      },
    ])
    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      n: 1,
      maxImagesPerCall: 1,
      maxRetries: 0,
      size: '1536x1024',
      providerOptions: {
        openai: {
          quality: 'medium',
          outputFormat: 'webp',
          outputCompression: 85,
        },
      },
    }))
    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'assistant',
      originProvider: 'openai',
      mediaType: 'image/webp',
    }))
    expect(mocks.acquireImageGenerationLease).toHaveBeenCalledWith(1)
    expect(mocks.releaseImageGenerationLease).toHaveBeenCalledWith({
      userId: 1,
      token: 'lease-token',
    })
  })

  it('runs preliminary image phases through the real AI SDK stream', async () => {
    const { chunks, message } = await runImageToolThroughAIStream()
    const toolOutputs = chunks.filter((chunk) => {
      return chunk.type === 'tool-output-available'
    })

    expect(toolOutputs.map(chunk => chunk.output)).toEqual([
      { status: 'generating' },
      { status: 'saving' },
      expect.objectContaining({
        status: 'ready',
        provider: 'openai',
        model: 'gpt-image-2',
      }),
      expect.objectContaining({
        status: 'ready',
        provider: 'openai',
        model: 'gpt-image-2',
      }),
    ])
    expect(toolOutputs.map(chunk => chunk.preliminary)).toEqual([
      true,
      true,
      true,
      undefined,
    ])
    expect(message).toBeDefined()

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts: message?.parts || [],
      providerId: 'openai',
      chatId: 'chat-stream-success',
      userId: 1,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual(expect.arrayContaining([
      {
        type: 'file',
        mediaType: 'image/webp',
        filename: 'quiet-forest.webp',
        url: '/files/generated.webp',
      },
    ]))
    expect(normalizedParts.some((part) => {
      return part.type === 'tool-generate_image'
    })).toBe(false)
    expect(mocks.generateImage).toHaveBeenCalledOnce()
    expect(mocks.persistFile).toHaveBeenCalledOnce()
  })

  it('serializes a safe image tool error through the real AI SDK stream', async () => {
    mocks.generateImage.mockRejectedValue(Object.assign(
      new Error('raw provider secret sk-live-secret'),
      { status: 401 },
    ))

    const { chunks, message } = await runImageToolThroughAIStream()
    const errorChunk = chunks.find((chunk) => {
      return chunk.type === 'tool-output-error'
    })

    expect(errorChunk).toMatchObject({
      type: 'tool-output-error',
    })
    expect(JSON.stringify(errorChunk)).toContain('provider-auth')
    expect(JSON.stringify(errorChunk)).not.toContain('sk-live-secret')
    expect(message).toBeDefined()

    const normalizedParts = await normalizeAssistantMessagePartsForPersistence({
      parts: message?.parts || [],
      providerId: 'openai',
      chatId: 'chat-stream-error',
      userId: 1,
      logger: { set: vi.fn() },
    })

    expect(normalizedParts).toEqual(expect.arrayContaining([
      {
        type: 'text',
        text: [
          'The image provider rejected the saved API key.',
          'Update the provider key in settings, then try again.',
        ].join(' '),
      },
    ]))
    expect(JSON.stringify(normalizedParts)).not.toContain('sk-live-secret')
    expect(mocks.generateImage).toHaveBeenCalledOnce()
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('passes supported 1K image options to Google', async () => {
    await executeTool('google', '1:1')

    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      aspectRatio: '1:1',
      providerOptions: {
        google: {
          imageConfig: {
            aspectRatio: '1:1',
            imageSize: '1K',
          },
        },
      },
    }))
  })

  it('rejects before provider spend without 10 MB free', async () => {
    mocks.getEffectiveUserFilePolicy.mockResolvedValue(
      createPolicy(12 * 1024 * 1024),
    )
    mocks.getUserStorageUsageBytes.mockResolvedValue(3 * 1024 * 1024)

    await expect(executeTool('openai')).rejects.toMatchObject({
      message: 'Not enough storage space to generate an image.',
    })
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('rejects malformed and oversized provider images', () => {
    expect(() => {
      validateGeneratedImage(new Uint8Array([1, 2, 3]), 'image/webp')
    }).toThrow('The generated image could not be saved.')

    expect(() => {
      validateGeneratedImage(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46,
          0x04, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
        ]),
        'image/webp',
      )
    }).toThrow('The generated image could not be saved.')

    expect(() => {
      validateGeneratedImage(
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47,
          0x0d, 0x0a, 0x1a, 0x0a,
        ]),
        'image/png',
      )
    }).toThrow('The generated image could not be saved.')

    expect(() => {
      validateGeneratedImage(
        new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        'image/jpeg',
      )
    }).toThrow('The generated image could not be saved.')

    expect(() => {
      validateGeneratedImage(
        new Uint8Array(MAX_GENERATED_IMAGE_BYTES + 1),
        'image/png',
      )
    }).toThrow('The generated image could not be saved.')
  })

  it('claims a created tool before concurrent executions can spend twice', async () => {
    const imageTool = createImageGenerationTool({
      userId: 1,
      provider: 'openai',
      model: 'gpt-image-2',
      imageModel: {} as ImageModel,
      logger: { set: vi.fn() },
    })
    const createExecution = (toolCallId: string) => {
      return imageTool.execute?.(
        {
          prompt: 'A quiet forest at dawn',
          aspectRatio: '1:1',
          fileName: 'Quiet forest',
        },
        {
          toolCallId,
          messages: [],
          abortSignal: undefined,
        },
      ) as AsyncIterable<ImageGenerationToolOutput>
    }
    const collect = async (
      execution: AsyncIterable<ImageGenerationToolOutput>,
    ) => {
      const outputs: ImageGenerationToolOutput[] = []

      for await (const output of execution) {
        outputs.push(output)
      }

      return outputs
    }
    const attempts = await Promise.allSettled([
      collect(createExecution('tool-1')),
      collect(createExecution('tool-2')),
    ])

    expect(attempts.filter(attempt => attempt.status === 'fulfilled'))
      .toHaveLength(1)
    expect(attempts.filter(attempt => attempt.status === 'rejected'))
      .toHaveLength(1)
    expect(attempts.find(attempt => attempt.status === 'rejected'))
      .toMatchObject({
        reason: expect.objectContaining({
          code: 'generation-busy',
        }),
      })
    expect(mocks.generateImage).toHaveBeenCalledOnce()
  })

  it('never logs or exposes raw provider exception text', async () => {
    const loggerSet = vi.fn()
    const imageTool = createImageGenerationTool({
      userId: 1,
      provider: 'openai',
      model: 'gpt-image-2',
      imageModel: {} as ImageModel,
      logger: { set: loggerSet },
    })
    const execution = imageTool.execute?.(
      {
        prompt: 'A quiet forest at dawn',
        aspectRatio: '1:1',
        fileName: 'Quiet forest',
      },
      {
        toolCallId: 'tool-1',
        messages: [],
        abortSignal: undefined,
      },
    ) as AsyncIterable<ImageGenerationToolOutput>

    mocks.generateImage.mockRejectedValue(Object.assign(
      new Error('raw provider secret diagnostic'),
      {
        status: 500,
        requestId: 'provider-request-1',
      },
    ))

    await expect(async () => {
      for await (const output of execution) {
        expect(output).toEqual({ status: 'generating' })
      }
    }).rejects.toMatchObject({
      message: 'The image provider is temporarily unavailable.',
    })
    expect(JSON.stringify(loggerSet.mock.calls))
      .not.toContain('raw provider secret diagnostic')
    expect(JSON.stringify(loggerSet.mock.calls))
      .toContain('provider-request-1')
  })
})
