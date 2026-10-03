import type { ImageModel } from 'ai'
import type { ImageGenerationToolOutput } from '#shared/types/image-generation.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImageGenerationTool,
  getProviderGenerationOptions,
} from '../../../../server/utils/ai/image-generation'

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

function createPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00,
    0x00, 0x00, 0x00, 0x01,
    0x49, 0x44, 0x41, 0x54,
    0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0x00, 0x00, 0x00, 0x00,
  ])
}

describe('getProviderGenerationOptions for xai', () => {
  it('returns only a top-level aspectRatio, with no size key, for '
    + 'every supported aspect ratio', () => {
    for (const aspectRatio of ['1:1', '2:3', '3:2'] as const) {
      const options = getProviderGenerationOptions('xai', aspectRatio)

      expect(options).toEqual({ aspectRatio })
      expect(options).not.toHaveProperty('size')
    }
  })

  it('carries no providerOptions.xai key at all', () => {
    const options = getProviderGenerationOptions('xai', '1:1')

    expect(options).not.toHaveProperty('providerOptions')
  })
})

describe('xAI image generation tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEffectiveUserFilePolicy.mockResolvedValue({
      tier: 'free' as const,
      maxStorageBytes: 20 * 1024 * 1024,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
    })
    mocks.getUserStorageUsageBytes.mockResolvedValue(0)
    mocks.acquireImageGenerationLease.mockResolvedValue({
      userId: 1,
      token: 'lease-token',
    })
    mocks.releaseImageGenerationLease.mockResolvedValue(true)
    mocks.generateImage.mockResolvedValue({
      image: {
        uint8Array: createPngBytes(),
        mediaType: 'image/png',
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
      storageKey: 'generated.png',
      name: 'grok-image.png',
      size: 58,
      type: 'image/png',
      source: 'assistant',
      expiresAt: null,
    })
  })

  it('persists a valid PNG returned by the xAI image model', async () => {
    const imageTool = createImageGenerationTool({
      userId: 1,
      provider: 'xai',
      model: 'grok-imagine-image-2.0',
      imageModel: {} as ImageModel,
      logger: { set: vi.fn() },
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
    const outputs: ImageGenerationToolOutput[] = []

    for await (const output of execution) {
      outputs.push(output)
    }

    expect(outputs.at(-1)).toEqual({
      status: 'ready',
      file: {
        id: 'file-1',
        storageKey: 'generated.png',
        name: 'grok-image.png',
        size: 58,
        type: 'image/png',
        source: 'assistant',
        url: '/files/generated.png',
        downloadUrl: '/files/generated.png?download=1',
      },
      provider: 'xai',
      model: 'grok-imagine-image-2.0',
    })
    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      aspectRatio: '1:1',
    }))
    expect(mocks.generateImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.anything() }),
    )
    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'assistant',
      originProvider: 'xai',
      mediaType: 'image/png',
    }))
  })
})
