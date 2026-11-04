import type { ImageModel, UIMessage } from 'ai'
import type { ImageGenerationToolOutput } from '#shared/types/image-generation.d'
import type { PreviousImageSource } from '../../../../server/utils/ai/image-generation'
import { createOpenAI } from '@ai-sdk/openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_IMAGE_EDIT_SOURCE_BYTES,
  MAX_IMAGE_EDIT_SOURCE_IMAGES,
  createImageGenerationTool,
  filterImageEditSourceImages,
  findPreviousGeneratedImage,
  getImageEditSourceImages,
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

function createDataUrl(mediaType: string, label: string): string {
  return `data:${mediaType};base64,${btoa(label)}`
}

function createSizedDataUrl(mediaType: string, base64Length: number): string {
  return `data:${mediaType};base64,${'A'.repeat(base64Length)}`
}

function createFilePart(url: string, mediaType: string) {
  return {
    type: 'file' as const,
    url,
    mediaType,
  }
}

function createMessage(
  role: UIMessage['role'],
  parts: UIMessage['parts'],
  id: string = `${role}-message`,
): UIMessage {
  return { id, role, parts }
}

async function runTool(
  imageTool: ReturnType<typeof createImageGenerationTool>,
  overrides: { editPreviousImage?: boolean } = {},
): Promise<ImageGenerationToolOutput[]> {
  const execution = imageTool.execute?.(
    {
      prompt: 'Make the sky purple',
      aspectRatio: '1:1',
      fileName: 'Purple sky',
      ...overrides,
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

function createTool(
  sourceImages?: string[],
  logger = { set: vi.fn() },
  previousImage?: PreviousImageSource,
) {
  return createImageGenerationTool({
    userId: 1,
    provider: 'openai',
    model: 'gpt-image-2',
    imageModel: {} as ImageModel,
    logger,
    sourceImages,
    previousImage,
  })
}

function createPreviousImage(
  dataUrl: string | null,
  options: { name?: string } = { name: 'blue-square.webp' },
) {
  const load = vi.fn(async () => dataUrl)

  return { load, source: { name: options.name, load } }
}

function createGeneratedFilePart(
  storageKey: string,
  mediaType: string = 'image/webp',
  filename?: string,
) {
  return {
    type: 'file' as const,
    url: `/files/${storageKey}?generated=1`,
    mediaType,
    filename,
  }
}

const expectedOpenAIOptions = {
  size: '1024x1024',
  providerOptions: {
    openai: {
      quality: 'medium',
      outputFormat: 'webp',
      outputCompression: 85,
    },
  },
}

function getImageEntries(body: FormData): FormDataEntryValue[] {
  return Array.from(body.entries())
    .filter(([key]) => {
      return key === 'image' || key === 'image[]'
    })
    .map(([, value]) => value)
}

describe('OpenAI image generation tool execution', () => {
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
      name: 'purple-sky.png',
      size: 58,
      type: 'image/png',
      source: 'assistant',
      expiresAt: null,
    })
  })

  it('sends a plain string prompt when no source images exist', async () => {
    const outputs = await runTool(createTool())

    expect(outputs.at(-1)).toMatchObject({ status: 'ready' })
    expect(mocks.generateImage).toHaveBeenCalledTimes(1)

    const call = mocks.generateImage.mock.calls[0]![0]

    expect(call.prompt).toBe('Make the sky purple')
    expect(call.n).toBe(1)
    expect(call.size).toBe(expectedOpenAIOptions.size)
    expect(call.providerOptions).toEqual(expectedOpenAIOptions.providerOptions)
  })

  it('sends images and text when source images exist', async () => {
    const pngDataUrl = createDataUrl('image/png', 'png-source')

    await runTool(createTool([pngDataUrl]))

    expect(mocks.generateImage).toHaveBeenCalledTimes(1)

    const call = mocks.generateImage.mock.calls[0]![0]

    expect(call.prompt).toEqual({
      images: [pngDataUrl],
      text: 'Make the sky purple',
    })
    expect(call.prompt).not.toHaveProperty('mask')
    expect(call.n).toBe(1)
    expect(call.size).toBe(expectedOpenAIOptions.size)
    expect(call.providerOptions).toEqual(expectedOpenAIOptions.providerOptions)
  })

  it('sends a plain string prompt for an empty source image list', async () => {
    await runTool(createTool([]))

    const call = mocks.generateImage.mock.calls[0]![0]

    expect(call.prompt).toBe('Make the sky purple')
  })

  it('keeps the order of multiple source images', async () => {
    const sourceImages = [
      createDataUrl('image/png', 'first'),
      createDataUrl('image/jpeg', 'second'),
      createDataUrl('image/webp', 'third'),
    ]

    await runTool(createTool(sourceImages))

    const call = mocks.generateImage.mock.calls[0]![0]

    expect(call.prompt.images).toEqual(sourceImages)
  })

  it('logs the edit mode and source image count', async () => {
    const logger = { set: vi.fn() }

    await runTool(createTool([createDataUrl('image/png', 'one')], logger))

    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        imageGeneration: expect.objectContaining({
          mode: 'edit',
          source: 'attached',
          sourceImages: 1,
        }),
      },
    }))
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      imageGeneration: {
        status: 'ready',
        durationMs: expect.any(Number),
        size: 58,
        warnings: 0,
      },
    }))
  })

  it('logs the generate mode when no source images exist', async () => {
    const logger = { set: vi.fn() }

    await runTool(createTool(undefined, logger))

    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        imageGeneration: expect.objectContaining({
          mode: 'generate',
          source: 'none',
          sourceImages: 0,
        }),
      },
    }))
  })

  it('logs the mode when generation fails', async () => {
    const logger = { set: vi.fn() }

    mocks.generateImage.mockRejectedValue(new Error('provider down'))

    await expect(
      runTool(createTool([createDataUrl('image/png', 'one')], logger)),
    ).rejects.toBeDefined()
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        imageGeneration: expect.objectContaining({
          mode: 'edit',
          source: 'attached',
        }),
      },
    }))
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      imageGeneration: expect.not.objectContaining({
        mode: expect.anything(),
      }),
    }))
  })

  it('describes editing only when source images are present', () => {
    const generateDescription = createTool().description
    const editDescription = createTool([
      createDataUrl('image/png', 'one'),
    ]).description

    expect(generateDescription).toBe([
      'Generate one image from the user request and save it to their private',
      'Besidka files. Use the full visual request as prompt. Return the saved',
      'file produced by this tool; do not claim that image generation is',
      'unavailable.',
    ].join(' '))
    expect(editDescription).not.toBe(generateDescription)
    expect(editDescription).toContain('attached')
    expect(editDescription).toContain('source to edit')
    expect(editDescription).toContain('what to change and what to keep')
    expect(editDescription).toContain('aspectRatio closest to')
  })

  describe('editing the previous generated image', () => {
    const previousDataUrl = createDataUrl('image/webp', 'previous-image')

    it('exposes editPreviousImage and names the file when a previous '
      + 'image exists', () => {
      const { source } = createPreviousImage(previousDataUrl)
      const imageTool = createTool(undefined, undefined, source)
      const shape = (imageTool.inputSchema as unknown as {
        shape: Record<string, unknown>
      }).shape

      expect(shape).toHaveProperty('editPreviousImage')
      expect(imageTool.description).toContain('"blue-square.webp"')
      expect(imageTool.description).toContain('editPreviousImage')
      expect(imageTool.description).toContain('earlier image')
      expect(imageTool.description).toContain('what to keep unchanged')
      expect(imageTool.description).toContain(
        'do not claim that image generation is unavailable.',
      )
    })

    it('keeps the original schema and description without a previous '
      + 'image', () => {
      const imageTool = createTool()
      const shape = (imageTool.inputSchema as unknown as {
        shape: Record<string, unknown>
      }).shape

      expect(shape).not.toHaveProperty('editPreviousImage')
      expect(imageTool.description).toBe([
        'Generate one image from the user request and save it to their private',
        'Besidka files. Use the full visual request as prompt. Return the saved',
        'file produced by this tool; do not claim that image generation is',
        'unavailable.',
      ].join(' '))
    })

    it('omits the file name from the description when it is unknown', () => {
      const { source } = createPreviousImage(previousDataUrl, {})
      const imageTool = createTool(undefined, undefined, source)

      expect(imageTool.description).toContain(
        'An earlier image from this chat is available to edit.',
      )
    })

    it('prefers attachments over the previous image', async () => {
      const attached = createDataUrl('image/png', 'attached')
      const { load, source } = createPreviousImage(previousDataUrl)
      const imageTool = createTool([attached], undefined, source)
      const shape = (imageTool.inputSchema as unknown as {
        shape: Record<string, unknown>
      }).shape

      expect(shape).not.toHaveProperty('editPreviousImage')
      expect(imageTool.description).toContain('attached')
      expect(imageTool.description).not.toContain('editPreviousImage')

      await runTool(imageTool, { editPreviousImage: true })

      const call = mocks.generateImage.mock.calls[0]![0]

      expect(call.prompt).toEqual({
        images: [attached],
        text: 'Make the sky purple',
      })
      expect(load).toHaveBeenCalledTimes(0)
    })

    it('sends a plain prompt and skips the loader when the flag is false',
      async () => {
        const { load, source } = createPreviousImage(previousDataUrl)

        await runTool(
          createTool(undefined, undefined, source),
          { editPreviousImage: false },
        )

        expect(mocks.generateImage.mock.calls[0]![0].prompt).toBe(
          'Make the sky purple',
        )
        expect(load).toHaveBeenCalledTimes(0)
      },
    )

    it('sends a plain prompt and skips the loader when the flag is omitted',
      async () => {
        const logger = { set: vi.fn() }
        const { load, source } = createPreviousImage(previousDataUrl)

        await runTool(createTool(undefined, logger, source))

        expect(mocks.generateImage.mock.calls[0]![0].prompt).toBe(
          'Make the sky purple',
        )
        expect(load).toHaveBeenCalledTimes(0)
        expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
          attributes: {
            imageGeneration: expect.objectContaining({
              mode: 'generate',
              source: 'none',
              sourceImages: 0,
            }),
          },
        }))
      },
    )

    it('edits the previous image when the flag is true', async () => {
      const logger = { set: vi.fn() }
      const { load, source } = createPreviousImage(previousDataUrl)

      const outputs = await runTool(
        createTool(undefined, logger, source),
        { editPreviousImage: true },
      )

      expect(outputs.at(-1)).toMatchObject({ status: 'ready' })
      expect(load).toHaveBeenCalledTimes(1)

      const call = mocks.generateImage.mock.calls[0]![0]

      expect(call.prompt).toEqual({
        images: [previousDataUrl],
        text: 'Make the sky purple',
      })
      expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
        attributes: {
          imageGeneration: expect.objectContaining({
            mode: 'edit',
            source: 'previous',
            sourceImages: 1,
          }),
        },
      }))

      const successTopLevel = logger.set.mock.calls
        .map(([payload]) => payload.imageGeneration)
        .find(value => value?.status === 'ready')

      expect(successTopLevel).not.toHaveProperty('mode')
      expect(successTopLevel).not.toHaveProperty('source')
      expect(successTopLevel).not.toHaveProperty('sourceImages')
    })

    it('fails with source-image-unavailable when the loader returns null',
      async () => {
        const logger = { set: vi.fn() }
        const { load, source } = createPreviousImage(null)

        await expect(
          runTool(
            createTool(undefined, logger, source),
            { editPreviousImage: true },
          ),
        ).rejects.toMatchObject({
          message: 'The earlier image is no longer available to edit.',
          status: 404,
        })

        expect(load).toHaveBeenCalledTimes(1)
        expect(mocks.generateImage).not.toHaveBeenCalled()
        expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
          attributes: {
            imageGeneration: expect.objectContaining({
              mode: 'edit',
              source: 'previous',
              errorCode: 'source-image-unavailable',
            }),
          },
        }))
        expect(mocks.releaseImageGenerationLease).toHaveBeenCalledTimes(1)
      },
    )

    it('fails with source-image-unavailable when the loaded image is not '
      + 'an editable image', async () => {
      const { source } = createPreviousImage(
        createDataUrl('image/gif', 'gif'),
      )

      await expect(
        runTool(
          createTool(undefined, undefined, source),
          { editPreviousImage: true },
        ),
      ).rejects.toMatchObject({
        message: 'The earlier image is no longer available to edit.',
      })
      expect(mocks.generateImage).not.toHaveBeenCalled()
    })
  })

  describe('through the real OpenAI image model', () => {
    function createMockFetch() {
      const pngBase64 = Buffer.from(createPngBytes()).toString('base64')

      return vi.fn(async () => {
        return new Response(
          JSON.stringify({ data: [{ b64_json: pngBase64 }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      })
    }

    async function runWithRealGenerateImage(
      sourceImages: string[] | undefined,
    ) {
      const actual = await vi.importActual<typeof import('ai')>('ai')
      const mockFetch = createMockFetch()
      const openai = createOpenAI({
        apiKey: 'test',
        fetch: mockFetch as unknown as typeof fetch,
      })

      mocks.generateImage.mockImplementation(actual.generateImage)
      mocks.persistFile.mockResolvedValue({
        id: 'file-1',
        storageKey: 'generated.png',
        name: 'purple-sky.png',
        size: 58,
        type: 'image/png',
        source: 'assistant',
        expiresAt: null,
      })

      const imageTool = createImageGenerationTool({
        userId: 1,
        provider: 'openai',
        model: 'gpt-image-2',
        imageModel: openai.image('gpt-image-2'),
        logger: { set: vi.fn() },
        sourceImages,
      })

      const outputs = await runTool(imageTool)

      return { mockFetch, outputs }
    }

    it('posts to images/edits as multipart form data with source images',
      async () => {
        const { mockFetch, outputs } = await runWithRealGenerateImage([
          createDataUrl('image/png', 'first'),
          createDataUrl('image/jpeg', 'second'),
        ])

        expect(outputs.at(-1)).toMatchObject({ status: 'ready' })
        expect(mockFetch).toHaveBeenCalledTimes(1)

        const [url, init] = mockFetch.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ]
        const body = init.body as FormData

        expect(String(url)).toMatch(/\/images\/edits$/)
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('model')).toBe('gpt-image-2')
        expect(body.get('prompt')).toBe('Make the sky purple')
        const imageEntries = getImageEntries(body)

        expect(imageEntries).toHaveLength(2)
        expect(imageEntries.map(entry => (entry as Blob).type)).toEqual([
          'image/png',
          'image/jpeg',
        ])
        expect(body.get('output_compression')).toBe('85')
        expect(body.has('mask')).toBe(false)
        expect(body.has('input_fidelity')).toBe(false)
        expect(body.get('quality')).toBe('medium')
        expect(body.get('output_format')).toBe('webp')
      },
    )

    it('posts to images/generations as JSON without source images',
      async () => {
        const { mockFetch, outputs } = await runWithRealGenerateImage(
          undefined,
        )

        expect(outputs.at(-1)).toMatchObject({ status: 'ready' })
        expect(mockFetch).toHaveBeenCalledTimes(1)

        const [url, init] = mockFetch.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ]
        const body = JSON.parse(String(init.body))

        expect(String(url)).toMatch(/\/images\/generations$/)
        expect(body.model).toBe('gpt-image-2')
        expect(body.prompt).toBe('Make the sky purple')
        expect(body).not.toHaveProperty('image')
      },
    )
  })
})

describe('getImageEditSourceImages', () => {
  it('keeps png, jpeg and webp data urls of the latest user message in '
    + 'order', () => {
    const png = createDataUrl('image/png', 'png')
    const jpeg = createDataUrl('image/jpeg', 'jpeg')
    const webp = createDataUrl('image/webp', 'webp')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [
        { type: 'text', text: 'Edit these' },
        createFilePart(png, 'image/png'),
        createFilePart(jpeg, 'image/jpeg'),
        createFilePart(webp, 'image/webp'),
      ]),
    ])

    expect(sourceImages).toEqual([png, jpeg, webp])
  })

  it('drops unsupported, non-data and non-file parts', () => {
    const png = createDataUrl('image/png', 'png')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [
        { type: 'text', text: 'Edit this' },
        createFilePart(createDataUrl('application/pdf', 'pdf'), 'application/pdf'),
        createFilePart('/files/stored-image.png', 'image/png'),
        createFilePart(createDataUrl('image/gif', 'gif'), 'image/gif'),
        createFilePart(png, 'image/png'),
      ]),
    ])

    expect(sourceImages).toEqual([png])
  })

  it('drops a part declared as an image whose header is not an image', () => {
    const mislabeledPdf = createDataUrl('application/pdf', 'pdf')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [createFilePart(mislabeledPdf, 'image/png')]),
    ])

    expect(sourceImages).toEqual([])
  })

  it('keeps a part whose header is an image despite its declared type', () => {
    const png = createDataUrl('image/png', 'png')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [
        createFilePart(png, 'application/octet-stream'),
      ]),
    ])

    expect(sourceImages).toEqual([png])
  })

  it('keeps a data url with an uppercase header media type', () => {
    const upperCasePng = createDataUrl('IMAGE/PNG', 'upper')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [createFilePart(upperCasePng, 'image/png')]),
    ])

    expect(sourceImages).toEqual([upperCasePng])
  })

  it('skips an image over the byte budget and keeps a later small one', () => {
    const base64Length = Math.ceil(MAX_IMAGE_EDIT_SOURCE_BYTES * 4 / 3) + 4
    const oversized = createSizedDataUrl('image/png', base64Length)
    const small = createDataUrl('image/png', 'small')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [
        createFilePart(oversized, 'image/png'),
        createFilePart(small, 'image/png'),
      ]),
    ])

    expect(sourceImages).toEqual([small])
  })

  it('cuts a run of images where the total would exceed the budget', () => {
    const bulky = [
      createSizedDataUrl('image/png', 12_000_000),
      createSizedDataUrl('image/jpeg', 12_000_001),
      createSizedDataUrl('image/webp', 12_000_002),
    ]
    const small = createDataUrl('image/png', 'small')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [
        ...bulky.map(url => createFilePart(url, 'image/png')),
        createFilePart(small, 'image/png'),
      ]),
    ])

    expect(sourceImages).toEqual([bulky[0], bulky[1], small])
  })

  it('ignores images from earlier user and assistant messages', () => {
    const oldUserImage = createDataUrl('image/png', 'old-user')
    const assistantImage = createDataUrl('image/png', 'assistant')
    const newImage = createDataUrl('image/png', 'new')

    const sourceImages = getImageEditSourceImages([
      createMessage('user', [createFilePart(oldUserImage, 'image/png')], 'u1'),
      createMessage('assistant', [
        createFilePart(assistantImage, 'image/png'),
      ], 'a1'),
      createMessage('user', [
        { type: 'text', text: 'Now edit this one' },
        createFilePart(newImage, 'image/png'),
      ], 'u2'),
    ])

    expect(sourceImages).toEqual([newImage])
  })

  it('uses the latest user message even when an assistant message follows',
    () => {
      const userImage = createDataUrl('image/png', 'user')
      const assistantImage = createDataUrl('image/png', 'assistant')

      const sourceImages = getImageEditSourceImages([
        createMessage('user', [createFilePart(userImage, 'image/png')], 'u1'),
        createMessage('assistant', [
          createFilePart(assistantImage, 'image/png'),
        ], 'a1'),
      ])

      expect(sourceImages).toEqual([userImage])
    },
  )

  it('caps the result at the maximum number of source images', () => {
    const parts = Array.from(
      { length: MAX_IMAGE_EDIT_SOURCE_IMAGES + 4 },
      (_value, index) => {
        return createFilePart(
          createDataUrl('image/png', `image-${index}`),
          'image/png',
        )
      },
    )

    const sourceImages = getImageEditSourceImages([
      createMessage('user', parts),
    ])

    expect(MAX_IMAGE_EDIT_SOURCE_IMAGES).toBe(16)
    expect(sourceImages).toHaveLength(16)
    expect(sourceImages[0]).toBe(parts[0]!.url)
    expect(sourceImages[15]).toBe(parts[15]!.url)
  })

  it('returns an empty list when the latest user message has no images',
    () => {
      const sourceImages = getImageEditSourceImages([
        createMessage('user', [
          createFilePart(createDataUrl('image/png', 'old'), 'image/png'),
        ], 'u1'),
        createMessage('assistant', [{ type: 'text', text: 'Done' }], 'a1'),
        createMessage('user', [{ type: 'text', text: 'Draw a cat' }], 'u2'),
      ])

      expect(sourceImages).toEqual([])
    },
  )

  it('returns an empty list without messages or parts', () => {
    expect(getImageEditSourceImages([])).toEqual([])
    expect(getImageEditSourceImages([
      { id: 'u1', role: 'user' } as unknown as UIMessage,
    ])).toEqual([])
  })
})

describe('filterImageEditSourceImages', () => {
  it('keeps supported data urls in order and drops everything else', () => {
    const png = createDataUrl('image/png', 'png')
    const webp = createDataUrl('image/webp', 'webp')

    expect(filterImageEditSourceImages([
      png,
      '/files/stored.png',
      createDataUrl('image/gif', 'gif'),
      createDataUrl('application/pdf', 'pdf'),
      webp,
    ])).toEqual([png, webp])
  })

  it('skips an oversized image and keeps later small ones', () => {
    const oversized = createSizedDataUrl(
      'image/png',
      Math.ceil(MAX_IMAGE_EDIT_SOURCE_BYTES * 4 / 3) + 4,
    )
    const small = createDataUrl('image/png', 'small')

    expect(filterImageEditSourceImages([oversized, small])).toEqual([small])
  })

  it('caps the result at the maximum number of source images', () => {
    const urls = Array.from(
      { length: MAX_IMAGE_EDIT_SOURCE_IMAGES + 2 },
      (_value, index) => createDataUrl('image/png', `image-${index}`),
    )

    expect(filterImageEditSourceImages(urls)).toEqual(
      urls.slice(0, MAX_IMAGE_EDIT_SOURCE_IMAGES),
    )
  })

  it('returns an empty list for an empty input', () => {
    expect(filterImageEditSourceImages([])).toEqual([])
  })
})

describe('findPreviousGeneratedImage', () => {
  it('picks the most recent generated image across several turns', () => {
    const previousImage = findPreviousGeneratedImage([
      createMessage('user', [{ type: 'text', text: 'Draw' }], 'u1'),
      createMessage('assistant', [
        createGeneratedFilePart('first.webp', 'image/webp', 'first.webp'),
      ], 'a1'),
      createMessage('user', [{ type: 'text', text: 'Darker' }], 'u2'),
      createMessage('assistant', [
        createGeneratedFilePart('second.png', 'image/png', 'second.png'),
        createGeneratedFilePart('third.png', 'image/png', 'third.png'),
      ], 'a2'),
      createMessage('user', [{ type: 'text', text: 'Thanks' }], 'u3'),
      createMessage('assistant', [{ type: 'text', text: 'Welcome' }], 'a3'),
    ])

    expect(previousImage).toEqual({
      storageKey: 'third.png',
      filename: 'third.png',
      mediaType: 'image/png',
    })
  })

  it('returns the image without a filename when none is stored', () => {
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [createGeneratedFilePart('only.webp')]),
    ])).toEqual({
      storageKey: 'only.webp',
      filename: undefined,
      mediaType: 'image/webp',
    })
  })

  it('ignores user-attached image parts', () => {
    expect(findPreviousGeneratedImage([
      createMessage('user', [
        createGeneratedFilePart('user-upload.png', 'image/png'),
        createFilePart(createDataUrl('image/png', 'x'), 'image/png'),
      ], 'u1'),
    ])).toBeNull()
  })

  it('ignores assistant file parts without the generated marker', () => {
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [
        createFilePart('/files/plain.png', 'image/png'),
      ], 'a1'),
    ])).toBeNull()
  })

  it('ignores unsupported media types and falls back to an older image',
    () => {
      const previousImage = findPreviousGeneratedImage([
        createMessage('assistant', [
          createGeneratedFilePart('older.png', 'image/png'),
        ], 'a1'),
        createMessage('assistant', [
          createGeneratedFilePart('animated.gif', 'image/gif'),
          createGeneratedFilePart('report.pdf', 'application/pdf'),
        ], 'a2'),
      ])

      expect(previousImage?.storageKey).toBe('older.png')
    },
  )

  it('returns null when the latest user message attaches an unsupported '
    + 'image', () => {
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [
        createGeneratedFilePart('older.png', 'image/png'),
      ], 'a1'),
      createMessage('user', [
        createFilePart(createDataUrl('image/gif', 'gif'), 'image/gif'),
      ], 'u1'),
    ])).toBeNull()
  })

  it('still finds the previous image when the latest user message only '
    + 'attaches a PDF', () => {
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [
        createGeneratedFilePart('older.png', 'image/png'),
      ], 'a1'),
      createMessage('user', [
        createFilePart(
          createDataUrl('application/pdf', 'pdf'),
          'application/pdf',
        ),
      ], 'u1'),
    ])?.storageKey).toBe('older.png')
  })

  it('ignores generated parts whose url has no local storage key', () => {
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [{
        type: 'file',
        url: 'https://example.com/x.png?generated=1',
        mediaType: 'image/png',
      }], 'a1'),
    ])).toBeNull()
  })

  it('returns null without messages or generated images', () => {
    expect(findPreviousGeneratedImage([])).toBeNull()
    expect(findPreviousGeneratedImage([
      createMessage('assistant', [{ type: 'text', text: 'Hi' }]),
      { id: 'a2', role: 'assistant' } as unknown as UIMessage,
    ])).toBeNull()
  })
})
