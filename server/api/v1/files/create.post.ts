import { createError } from 'evlog'
import { OFFICE_UPLOAD_MAX_BYTES } from '#shared/utils/office-files'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
  releaseImageTransformSlots,
  reserveImageTransformSlots,
} from '~~/server/utils/files/file-governance'
import { persistFile } from '~~/server/utils/files/persist-file'
import { createStorageFullError } from '~~/server/utils/storage/errors'
import {
  assertUploadContentLength,
  decodeUploadFileName,
  readUploadBody,
} from '~~/server/utils/files/upload-request'
import {
  looksLikeOfficeUpload,
  resolveUploadFileType,
} from '~~/server/utils/files/upload-file-type'
import {
  assertOfficeContentLength,
  assertOfficeUploadBytes,
  createOfficeFileTooLargeError,
} from '~~/server/utils/files/office-upload-check'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { defineEventHandler, getRequestHeader } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

/**
 * @example
 * const response = await $fetch('/api/v1/files/create', {
 *   method: 'POST',
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
  const logger = useRequestLogger(event)

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const fileType = getRequestHeader(event, 'content-type')
  const fileName = decodeUploadFileName(
    getRequestHeader(event, 'x-filename'),
  )

  const isOfficeWithoutType = !fileType
    && !!fileName
    && looksLikeOfficeUpload(fileName, fileType)

  if (!fileName || (!fileType && !isOfficeWithoutType)) {
    throw createError({
      message: 'Missing required headers',
      status: 400,
    })
  }

  const userId = parseInt(session.user.id)

  await requireLegalConsent(userId)

  const {
    mediaType: normalizedFileType,
    officeFormat,
  } = await resolveUploadFileType({
    event,
    fileName,
    declaredType: fileType,
    logger,
  })

  const policy = await getEffectiveUserFilePolicy(userId)
  const totalFilesSize = await getUserStorageUsageBytes(userId)

  const remainingStorageBytes = policy.maxStorageBytes - totalFilesSize

  const quota = {
    usedBytes: totalFilesSize,
    totalBytes: policy.maxStorageBytes,
  }

  const contentLength = assertUploadContentLength(
    getRequestHeader(event, 'content-length'),
    quota,
  )

  if (officeFormat) {
    assertOfficeContentLength(contentLength)
  }

  const fileBuffer = await readUploadBody(
    event.req.body,
    officeFormat
      ? Math.min(remainingStorageBytes, OFFICE_UPLOAD_MAX_BYTES)
      : remainingStorageBytes,
    quota,
    officeFormat ? createOfficeFileTooLargeError : undefined,
  )

  if (!fileBuffer.length) {
    throw createError({
      message: 'No file data provided',
      status: 400,
    })
  }

  if (officeFormat) {
    assertOfficeUploadBytes(fileName, officeFormat, fileBuffer)
  }

  const headerFileSize = Number(getRequestHeader(event, 'x-filesize') || 0)
  const parsedFileSize = fileBuffer.length

  if (headerFileSize > 0 && headerFileSize !== parsedFileSize) {
    logger.set({
      upload: {
        operation: 'size-mismatch',
        headerFileSize,
        actualFileSize: parsedFileSize,
      },
      attributes: {
        upload: {
          fileName,
          fileType,
        },
      },
    })
  }

  const wouldExceed = totalFilesSize + parsedFileSize > policy.maxStorageBytes

  if (wouldExceed) {
    throw createStorageFullError(quota)
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
            .input(view as unknown as ReadableStream<Uint8Array>)
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
            message: 'Transform response body was empty',
            status: 500,
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
            fileSize: parsedFileSize,
          },
          attributes: {
            upload: {
              fileName,
              fileType,
              error: exceptionMessage(exception),
            },
          },
        })
      }
    } else {
      logger.set({
        upload: {
          operation: 'transform-skipped',
          fileSize: parsedFileSize,
          reason: reservation.reason,
        },
        attributes: {
          upload: {
            fileName,
            fileType,
          },
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
