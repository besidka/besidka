import type { ImageModel } from 'ai'
import type { OpenAIImageModelGenerationOptions } from '@ai-sdk/openai'
import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type {
  ImageGenerationAspectRatio,
  ImageGenerationProvider,
  ImageGenerationToolOutput,
} from '#shared/types/image-generation.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { ImageGenerationLease } from './image-generation-lock'
import { createError } from 'evlog'
import { generateImage, tool } from 'ai'
import { z } from 'zod'
import {
  getPreferredFileExtension,
  normalizeMediaType,
} from '#shared/utils/files'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import { persistFile } from '~~/server/utils/files/persist-file'
import { getSafeImageGenerationError } from '~~/server/utils/ai/image-generation-errors'
import { getImageGenerationCost } from '~~/server/utils/ai/image-generation-cost'
import {
  acquireImageGenerationLease,
  releaseImageGenerationLease,
} from './image-generation-lock'

export const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_GENERATED_IMAGE_DIMENSION = 8192
export const MAX_GENERATED_IMAGE_PIXELS = 64 * 1024 * 1024

type GenerateImageOptions = Parameters<typeof generateImage>[0]

const imageAspectRatios = [
  '1:1',
  '2:3',
  '3:2',
] as const satisfies readonly ImageGenerationAspectRatio[]

const generateImageInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  aspectRatio: z.enum(imageAspectRatios).default('1:1'),
  fileName: z.string().trim().min(1).max(120).optional(),
})

export interface CreateImageGenerationToolInput {
  userId: number
  provider: ImageGenerationProvider
  model: string
  imageModel: ImageModel
  logger: LoggerLike
  requestId?: string
  onGenerated?: (result: {
    aspectRatio: ImageGenerationAspectRatio
  }) => void
}

export function createImageGenerationTool(
  input: CreateImageGenerationToolInput,
) {
  let isExecutionClaimed = false

  return tool({
    description: [
      'Generate one image from the user request and save it to their private',
      'Besidka files. Use the full visual request as prompt. Return the saved',
      'file produced by this tool; do not claim that image generation is',
      'unavailable.',
    ].join(' '),
    inputSchema: generateImageInputSchema,
    async* execute(
      { prompt, aspectRatio, fileName },
    ): AsyncGenerator<ImageGenerationToolOutput> {
      if (isExecutionClaimed) {
        throw createError({
          code: 'generation-busy',
          message: 'This image request has already been started.',
          status: 409,
          why: 'A model attempted to run the same image tool more than once.',
          fix: 'Send a new message if you want another image.',
        })
      }

      isExecutionClaimed = true

      const startedAt = Date.now()
      let lease: ImageGenerationLease | undefined

      try {
        await assertGeneratedImageStorageAvailable(input.userId)
        lease = await acquireImageGenerationLease(input.userId)

        yield { status: 'generating' }

        const result = await generateImage({
          model: input.imageModel,
          prompt,
          n: 1,
          maxImagesPerCall: 1,
          maxRetries: 0,
          ...getProviderGenerationOptions(
            input.provider,
            aspectRatio,
          ),
        })
        const image = result.image
        const validatedImage = validateGeneratedImage(
          image.uint8Array,
          image.mediaType,
        )

        yield { status: 'saving' }

        const persistedFile = await persistFile({
          userId: input.userId,
          fileName: buildGeneratedImageFileName(
            fileName || prompt,
            validatedImage.mediaType,
          ),
          mediaType: validatedImage.mediaType,
          fileData: validatedImage.data,
          source: 'assistant',
          originProvider: input.provider,
          originModel: input.model,
          generationCost: getImageGenerationCost(input.model, aspectRatio),
          logger: input.logger,
        })
        const url = `/files/${persistedFile.storageKey}`

        input.logger.set({
          imageGeneration: {
            status: 'ready',
            provider: input.provider,
            model: input.model,
            durationMs: Date.now() - startedAt,
            size: persistedFile.size,
            mediaType: persistedFile.type,
            warnings: result.warnings.length,
            usage: result.usage,
          },
        })

        input.onGenerated?.({ aspectRatio })

        yield {
          status: 'ready',
          file: {
            id: persistedFile.id,
            storageKey: persistedFile.storageKey,
            name: persistedFile.name,
            size: persistedFile.size,
            type: persistedFile.type,
            source: persistedFile.source,
            url,
            downloadUrl: `${url}?download=1`,
          },
          provider: input.provider,
          model: input.model,
        }
      } catch (exception) {
        const safeError = getSafeImageGenerationError(
          exception,
          input.provider,
        )

        input.logger.set({
          imageGeneration: {
            status: 'failed',
            provider: input.provider,
            model: input.model,
            durationMs: Date.now() - startedAt,
            errorCode: safeError.code,
            providerStatus: safeError.providerStatus,
            providerRequestId: safeError.providerRequestId,
            requestId: input.requestId,
          },
        })

        throw createError({
          code: safeError.code,
          message: safeError.message,
          status: safeError.status,
          why: safeError.why,
          fix: safeError.fix,
        })
      } finally {
        if (lease) {
          try {
            await releaseImageGenerationLease(lease)
          } catch {
            input.logger.set({
              imageGenerationLease: {
                status: 'release-failed',
                errorCode: 'lease-release-failed',
              },
            })
          }
        }
      }
    },
  })
}

async function assertGeneratedImageStorageAvailable(
  userId: number,
): Promise<void> {
  const policy = await getEffectiveUserFilePolicy(userId)
  const usedBytes = await getUserStorageUsageBytes(userId)
  const remainingBytes = Math.max(policy.maxStorageBytes - usedBytes, 0)

  if (remainingBytes >= MAX_GENERATED_IMAGE_BYTES) {
    return
  }

  throw createError({
    message: 'Not enough storage space to generate an image.',
    status: 400,
    why: 'Image generation requires at least 10 MB of available file storage.',
    fix: 'Delete files in the file manager, then try again.',
  })
}

function getProviderGenerationOptions(
  provider: ImageGenerationProvider,
  aspectRatio: ImageGenerationAspectRatio,
): Pick<GenerateImageOptions, 'size' | 'aspectRatio' | 'providerOptions'> {
  if (provider === 'openai') {
    const providerOptions = {
      quality: 'medium',
      outputFormat: 'webp',
      outputCompression: 85,
    } satisfies OpenAIImageModelGenerationOptions

    return {
      size: getOpenAIImageSize(aspectRatio),
      providerOptions: {
        openai: providerOptions,
      },
    } as const
  }

  const providerOptions = {
    imageConfig: {
      aspectRatio,
      imageSize: '1K',
    },
  } satisfies GoogleLanguageModelOptions

  return {
    aspectRatio,
    providerOptions: {
      google: providerOptions,
    },
  } as const
}

function getOpenAIImageSize(
  aspectRatio: ImageGenerationAspectRatio,
): '1024x1024' | '1024x1536' | '1536x1024' {
  if (aspectRatio === '2:3') {
    return '1024x1536'
  }

  if (aspectRatio === '3:2') {
    return '1536x1024'
  }

  return '1024x1024'
}

interface ValidatedGeneratedImage {
  data: Uint8Array
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}

export function validateGeneratedImage(
  data: Uint8Array,
  declaredMediaType: string,
): ValidatedGeneratedImage {
  if (data.byteLength === 0 || data.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw createError({
      message: 'The generated image could not be saved.',
      status: 502,
      why: data.byteLength === 0
        ? 'The provider returned an empty image.'
        : 'The provider returned an image larger than 10 MB.',
      fix: 'Try a simpler prompt or a different provider.',
    })
  }

  const detectedMediaType = detectGeneratedImageMediaType(data)
  const normalizedDeclaredMediaType = normalizeMediaType(declaredMediaType)

  if (
    !detectedMediaType
    || normalizedDeclaredMediaType !== detectedMediaType
  ) {
    throw createError({
      message: 'The generated image could not be saved.',
      status: 502,
      why: 'The provider returned an unsupported or malformed image.',
      fix: 'Try the request again or use a different provider.',
    })
  }

  return {
    data,
    mediaType: detectedMediaType,
  }
}

function detectGeneratedImageMediaType(
  data: Uint8Array,
): ValidatedGeneratedImage['mediaType'] | null {
  if (isValidPng(data)) {
    return 'image/png'
  }

  if (isValidJpeg(data)) {
    return 'image/jpeg'
  }

  if (isValidWebP(data)) {
    return 'image/webp'
  }

  return null
}

function isValidPng(data: Uint8Array): boolean {
  const hasSignature = data.length >= 45
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a

  if (!hasSignature) {
    return false
  }

  let offset = 8
  let hasHeader = false
  let hasImageData = false

  while (offset + 12 <= data.length) {
    const chunkLength = readUint32BigEndian(data, offset)
    const chunkEnd = offset + 12 + chunkLength

    if (chunkEnd > data.length) {
      return false
    }

    const chunkType = readAscii(data, offset + 4, 4)

    if (!hasHeader) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) {
        return false
      }

      const width = readUint32BigEndian(data, offset + 8)
      const height = readUint32BigEndian(data, offset + 12)

      if (!hasValidImageDimensions(width, height)) {
        return false
      }

      hasHeader = true
    } else if (chunkType === 'IHDR') {
      return false
    }

    if (chunkType === 'IDAT' && chunkLength > 0) {
      hasImageData = true
    }

    if (chunkType === 'IEND') {
      return chunkLength === 0
        && hasHeader
        && hasImageData
        && chunkEnd === data.length
    }

    offset = chunkEnd
  }

  return false
}

function isValidJpeg(data: Uint8Array): boolean {
  const hasContainerMarkers = data.length >= 16
    && data[0] === 0xff
    && data[1] === 0xd8
    && data[data.length - 2] === 0xff
    && data[data.length - 1] === 0xd9

  if (!hasContainerMarkers) {
    return false
  }

  let offset = 2
  let hasFrame = false

  while (offset < data.length - 2) {
    if (data[offset] !== 0xff) {
      return false
    }

    while (data[offset] === 0xff) {
      offset += 1
    }

    const marker = data[offset]

    if (marker === undefined || marker === 0x00 || marker === 0xd8) {
      return false
    }

    offset += 1

    if (marker === 0xd9) {
      return false
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      continue
    }

    if (marker === 0x01) {
      continue
    }

    if (offset + 2 > data.length - 2) {
      return false
    }

    const segmentLength = readUint16BigEndian(data, offset)
    const segmentEnd = offset + segmentLength

    if (segmentLength < 2 || segmentEnd > data.length - 2) {
      return false
    }

    if (isJpegFrameMarker(marker)) {
      if (segmentLength < 7) {
        return false
      }

      const height = readUint16BigEndian(data, offset + 3)
      const width = readUint16BigEndian(data, offset + 5)

      if (!hasValidImageDimensions(width, height)) {
        return false
      }

      hasFrame = true
    }

    if (marker === 0xda) {
      return hasFrame && segmentEnd < data.length - 2
    }

    offset = segmentEnd
  }

  return false
}

function isJpegFrameMarker(marker: number): boolean {
  return [
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ].includes(marker)
}

function isValidWebP(data: Uint8Array): boolean {
  if (
    data.length < 26
    || readAscii(data, 0, 4) !== 'RIFF'
    || readAscii(data, 8, 4) !== 'WEBP'
    || readUint32LittleEndian(data, 4) + 8 !== data.length
  ) {
    return false
  }

  let offset = 12
  let hasDimensions = false
  let hasImageData = false

  while (offset + 8 <= data.length) {
    const chunkType = readAscii(data, offset, 4)
    const chunkLength = readUint32LittleEndian(data, offset + 4)
    const chunkDataOffset = offset + 8
    const chunkEnd = chunkDataOffset + chunkLength
    const paddedChunkEnd = chunkEnd + (chunkLength % 2)

    if (paddedChunkEnd > data.length) {
      return false
    }

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) {
        return false
      }

      const width = readUint24LittleEndian(data, chunkDataOffset + 4) + 1
      const height = readUint24LittleEndian(data, chunkDataOffset + 7) + 1

      if (!hasValidImageDimensions(width, height)) {
        return false
      }

      hasDimensions = true
    }

    if (chunkType === 'VP8 ') {
      if (
        chunkLength <= 10
        || data[chunkDataOffset + 3] !== 0x9d
        || data[chunkDataOffset + 4] !== 0x01
        || data[chunkDataOffset + 5] !== 0x2a
      ) {
        return false
      }

      const width = readUint16LittleEndian(data, chunkDataOffset + 6) & 0x3fff
      const height = readUint16LittleEndian(data, chunkDataOffset + 8) & 0x3fff

      if (!hasValidImageDimensions(width, height)) {
        return false
      }

      hasDimensions = true
      hasImageData = true
    }

    if (chunkType === 'VP8L') {
      if (chunkLength <= 5 || data[chunkDataOffset] !== 0x2f) {
        return false
      }

      const first = data[chunkDataOffset + 1] || 0
      const second = data[chunkDataOffset + 2] || 0
      const third = data[chunkDataOffset + 3] || 0
      const fourth = data[chunkDataOffset + 4] || 0
      const width = 1 + first + ((second & 0x3f) << 8)
      const height = 1
        + (second >> 6)
        + (third << 2)
        + ((fourth & 0x0f) << 10)

      if (!hasValidImageDimensions(width, height)) {
        return false
      }

      hasDimensions = true
      hasImageData = true
    }

    if (chunkType === 'ANMF' && chunkLength >= 16) {
      hasImageData = true
    }

    offset = paddedChunkEnd
  }

  return offset === data.length && hasDimensions && hasImageData
}

function hasValidImageDimensions(width: number, height: number): boolean {
  return width > 0
    && height > 0
    && width <= MAX_GENERATED_IMAGE_DIMENSION
    && height <= MAX_GENERATED_IMAGE_DIMENSION
    && width * height <= MAX_GENERATED_IMAGE_PIXELS
}

function readAscii(
  data: Uint8Array,
  offset: number,
  length: number,
): string {
  return String.fromCharCode(...data.slice(offset, offset + length))
}

function readUint16BigEndian(data: Uint8Array, offset: number): number {
  return ((data[offset] || 0) << 8)
    | (data[offset + 1] || 0)
}

function readUint16LittleEndian(data: Uint8Array, offset: number): number {
  return (data[offset] || 0)
    | ((data[offset + 1] || 0) << 8)
}

function readUint24LittleEndian(data: Uint8Array, offset: number): number {
  return (data[offset] || 0)
    | ((data[offset + 1] || 0) << 8)
    | ((data[offset + 2] || 0) << 16)
}

function readUint32BigEndian(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] || 0) * 0x1000000)
    + ((data[offset + 1] || 0) << 16)
    + ((data[offset + 2] || 0) << 8)
    + (data[offset + 3] || 0)
  )
}

function readUint32LittleEndian(data: Uint8Array, offset: number): number {
  return (
    (data[offset] || 0)
    + ((data[offset + 1] || 0) << 8)
    + ((data[offset + 2] || 0) << 16)
    + ((data[offset + 3] || 0) * 0x1000000)
  )
}

function buildGeneratedImageFileName(
  value: string,
  mediaType: ValidatedGeneratedImage['mediaType'],
): string {
  const extension = getPreferredFileExtension(mediaType)
  const withoutExtension = value.replace(/\.[a-z0-9]{1,8}$/i, '')
  const baseName = withoutExtension
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)

  return `${baseName || 'generated-image'}.${extension}`
}
