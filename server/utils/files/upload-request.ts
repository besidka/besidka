import { createError } from 'evlog'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const UPLOAD_FILE_NAME_MAX_LENGTH = 255

export function decodeUploadFileName(rawFileName: string | undefined): string {
  if (!rawFileName) {
    return ''
  }

  let fileName: string

  try {
    fileName = decodeURIComponent(rawFileName)
  } catch (exception) {
    throw createError({
      message: 'Invalid file name',
      status: 400,
      why: `The x-filename header is not valid percent-encoded text (${
        exceptionMessage(exception)
      })`,
      fix: 'Send the file name encoded with encodeURIComponent',
    })
  }

  if (fileName.length > UPLOAD_FILE_NAME_MAX_LENGTH) {
    throw createError({
      message: 'File name is too long',
      status: 400,
      why: `File names are limited to ${UPLOAD_FILE_NAME_MAX_LENGTH} characters`,
      fix: 'Shorten the file name and try again',
    })
  }

  return fileName
}

export function assertUploadContentLength(
  contentLengthHeader: string | undefined,
  remainingStorageBytes: number,
): number | null {
  if (contentLengthHeader === undefined || contentLengthHeader === '') {
    return null
  }

  if (!/^\d+$/.test(contentLengthHeader.trim())) {
    throw createError({
      message: 'Invalid Content-Length header',
      status: 400,
    })
  }

  const contentLength = Number(contentLengthHeader)

  if (!Number.isSafeInteger(contentLength)) {
    throw createError({
      message: 'Invalid Content-Length header',
      status: 400,
    })
  }

  if (contentLength > Math.max(remainingStorageBytes, 0)) {
    throw createError({
      message: 'Not enough storage space. Please delete some files.',
      status: 413,
      why: 'The upload is larger than the remaining storage quota',
      fix: 'Delete some files or upload a smaller file',
    })
  }

  return contentLength
}

export async function readUploadBody(
  body: ReadableStream<Uint8Array> | null,
  remainingStorageBytes: number,
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array(0)
  }

  const maxBytes = Math.max(remainingStorageBytes, 0)
  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    totalBytes += value.byteLength

    if (totalBytes > maxBytes) {
      await reader.cancel()

      throw createError({
        message: 'Not enough storage space. Please delete some files.',
        status: 413,
        why: 'The upload is larger than the remaining storage quota',
        fix: 'Delete some files or upload a smaller file',
      })
    }

    chunks.push(value)
  }

  const fileBuffer = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    fileBuffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return fileBuffer
}
