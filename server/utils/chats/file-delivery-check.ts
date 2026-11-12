import { createError } from 'evlog'
import { describeFileDeliveryReason, resolveFileDelivery } from '#shared/utils/file-delivery'
import type { FileDeliveryRoute } from '#shared/utils/file-delivery'
import {
  extractLocalFileStorageKey,
  isHiddenFilePart,
} from '#shared/utils/files'
import { getInputMediaKind } from '#shared/utils/input-media-types'
import { isOfficeMediaType } from '#shared/utils/office-files'
import { getOwnedFilesByStorageKeys } from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { ensureOfficeTextState } from '~~/server/utils/files/office-text'

interface DeliveryFilePart {
  type: string
  mediaType?: string
  filename?: string
  url?: string
}

export interface AssertFilesDeliverableInput {
  parts: readonly DeliveryFilePart[]
  userId: number
  route: FileDeliveryRoute
  providerId?: string
  modalities?: readonly string[]
  modelName: string
  logger: LoggerLike
}

function getDisplayName(part: DeliveryFilePart): string {
  return part.filename?.trim() || 'A file'
}

/**
 * Checks every file of the message being sent against what the database says
 * the file is, not what the client declared, and answers a 400 that names the
 * file and the reason before anything is persisted or streamed. An Office
 * file stored before text extraction existed is read here once, so its text
 * is ready for the conversion that follows.
 */
export async function assertFilesDeliverable(
  input: AssertFilesDeliverableInput,
): Promise<void> {
  const fileParts = input.parts.filter((part) => {
    return part.type === 'file'
      && typeof part.url === 'string'
      && !isHiddenFilePart({ type: part.type, mediaType: part.mediaType })
  })

  if (fileParts.length === 0) {
    return
  }

  const storageKeys = fileParts.flatMap((part) => {
    const storageKey = extractLocalFileStorageKey(part.url as string)

    return storageKey ? [storageKey] : []
  })
  const ownedFiles = await getOwnedFilesByStorageKeys(
    input.userId,
    storageKeys,
  )

  for (const part of fileParts) {
    const storageKey = extractLocalFileStorageKey(part.url as string)
    const ownedFile = storageKey ? ownedFiles.get(storageKey) : undefined

    if (!storageKey || !ownedFile) {
      continue
    }

    const mediaType = ownedFile.type ?? part.mediaType

    if (!mediaType) {
      continue
    }

    const textState = isOfficeMediaType(mediaType)
      ? await ensureOfficeTextState(
        { ...ownedFile, userId: input.userId, type: mediaType },
        input.logger,
      )
      : null
    const { delivery, reason } = resolveFileDelivery({
      route: input.route,
      providerId: input.providerId,
      modalities: input.modalities,
      mediaType,
      textStatus: textState?.textStatus,
    })

    if (delivery !== 'unsupported') {
      continue
    }

    input.logger.set({
      attributes: {
        files: {
          deliveryRejected: { reason, mediaType },
        },
      },
    })

    const { why, fix } = describeFileDeliveryReason(reason)

    throw createError({
      message: `${getDisplayName(part)} cannot be sent to ${input.modelName}.`,
      status: 400,
      why,
      fix,
    })
  }
}

/**
 * The last line of defence before `convertToModelMessages`: the only `file`
 * parts that may reach a provider are images and PDFs. Anything else (an
 * Office file whose text was not read, a type no provider accepts) would be
 * thrown on by some SDKs and silently dropped by others, so it stops here
 * with a clear 400 instead.
 */
export function assertOnlyDeliverableFileParts(
  messages: readonly { parts: readonly DeliveryFilePart[] }[],
): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'file') {
        continue
      }

      const kind = getInputMediaKind(part.mediaType ?? '')

      if (kind === 'image' || kind === 'pdf') {
        continue
      }

      throw createError({
        message: `${getDisplayName(part)} cannot be sent to the model.`,
        status: 400,
        why: `Only images and PDFs can be sent as files, and this one is ${
          part.mediaType || 'of an unknown type'
        }.`,
        fix: 'Remove the file, or attach it as PDF, an image or plain text.',
      })
    }
  }
}
