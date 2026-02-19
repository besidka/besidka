import { useLogger } from 'evlog'
import { normalizeMediaType } from '#shared/utils/files'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
  releaseImageTransformSlots,
  reserveImageTransformSlots,
} from '~~/server/utils/files/file-governance'
import { persistFile } from '~~/server/utils/files/persist-file'

/**
 * @example
 * const response = await $fetch('/api/v1/files/upload', {
 *   method: 'PUT',
 *   body: new FormData()
 *     .append('file', file)
 *     .append('transform', JSON.stringify({
 *       options: { width: 800, height: 600 },
 *       format: 'image/webp',
 *     })),
 *
 *  const { key } = response
 *
 * @returns {Promise<{ key: string }>}
 */
export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const fileType = getRequestHeader(event, 'content-type')
  const fileName = decodeURIComponent(
    getRequestHeader(event, 'x-filename') || '',
  )

  if (!fileType || !fileName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required headers',
    })
  }

  const normalizedFileType = normalizeMediaType(fileType)

  if (!normalizedFileType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file media type',
    })
  }

  const fileBuffer = await readRawBody(event, false)

  if (!fileBuffer) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No file data provided',
    })
  }

  const userId = parseInt(session.user.id)
  const headerFileSize = Number(getRequestHeader(event, 'x-filesize') || 0)
  const parsedFileSize = fileBuffer.length

  if (headerFileSize > 0 && headerFileSize !== parsedFileSize) {
    logger.set({
      upload: {
        operation: 'size-mismatch',
        fileName,
        fileType,
        headerFileSize,
        actualFileSize: parsedFileSize,
      },
    })
  }

  const config = useRuntimeConfig(event).public
  const allowedFileFormats = config.allowedFileFormats as AllowedFileFormats

  if (
    !allowedFileFormats.includes(normalizedFileType as AllowedFileFormat)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `File type must be one of: ${allowedFileFormats.join(', ')}`,
    })
  }

  const policy = await getEffectiveUserFilePolicy(userId)
  const totalFilesSize = await getUserStorageUsageBytes(userId)
  const wouldExceed = totalFilesSize + parsedFileSize > policy.maxStorageBytes

  if (wouldExceed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Not enough storage space. Please delete some files.',
    })
  }

  const arrayBuffer = new ArrayBuffer(fileBuffer.length)
  const view = new Uint8Array(arrayBuffer)

  view.set(fileBuffer)

  const isFileImage = normalizedFileType.startsWith('image/')
  let fileToStore = view
  let transformed = false
  let hasReservedTransformSlots = false

  if (isFileImage) {
    const reservation = await reserveImageTransformSlots(userId)

    if (reservation.reserved) {
      hasReservedTransformSlots = true

      try {
        const transformedImage = (
          await useImageTransform()
            // @ts-expect-error
            .input(view)
            .transform({
              width: 800,
              fit: 'scale-down',
            })
            .output({
              format: 'image/webp',
            })
        ).response()

        if (!transformedImage.body) {
          throw createError({
            statusCode: 500,
            statusMessage: 'Transform response body was empty',
          })
        }

        const transformedArrayBuffer = await new Response(
          transformedImage.body as unknown as ReadableStream<Uint8Array>,
        ).arrayBuffer()
        fileToStore = new Uint8Array(transformedArrayBuffer)
        transformed = true
      } catch (exception) {
        await releaseImageTransformSlots(userId)
        hasReservedTransformSlots = false
        logger.set({
          upload: {
            operation: 'transform-fallback',
            fileName,
            fileType,
            fileSize: parsedFileSize,
            error: exception instanceof Error
              ? exception.message
              : String(exception),
          },
        })
      }
    } else {
      logger.set({
        upload: {
          operation: 'transform-skipped',
          fileName,
          fileType,
          fileSize: parsedFileSize,
          reason: reservation.reason,
        },
      })
    }
  }

  const fileMime = transformed
    ? 'image/webp'
    : normalizedFileType

  let storedFile

  try {
    storedFile = await persistFile({
      userId,
      fileName,
      mediaType: fileMime,
      fileData: fileToStore,
      quotaSizeBytes: parsedFileSize,
      source: 'upload',
      logger,
    })
  } catch (exception) {
    if (!transformed && hasReservedTransformSlots) {
      await releaseImageTransformSlots(userId)
    }

    throw exception
  }

  return storedFile
})
