import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { normalizeMediaType } from '#shared/utils/files'
import {
  OFFICE_MEDIA_TYPES,
  OFFICE_SAVE_AS_FIX,
  getAllowedFileFormats,
  getOfficeExtensionKind,
  getOfficeFormatByFileName,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import type { OfficeFormat } from '#shared/utils/office-files'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  assertSupportedOfficeExtension,
  createOfficeRejection,
} from '~~/server/utils/files/office-upload-check'

export const OFFICE_ATTACHMENTS_FLAG = 'files.office'

export interface ResolvedUploadFileType {
  mediaType: string
  officeFormat: OfficeFormat | null
}

export interface ResolveUploadFileTypeInput {
  event: Pick<RequestEvent, 'context'>
  fileName: string
  declaredType: string | undefined
  logger?: LoggerLike
}

export function looksLikeOfficeUpload(
  fileName: string,
  declaredType: string | undefined,
): boolean {
  return getOfficeExtensionKind(fileName) !== null
    || (declaredType !== undefined && isOfficeMediaType(declaredType))
}

/**
 * Whether the signed-in user has Office attachments on. It fails closed: a
 * flag evaluation that throws counts as off, so an outage never opens the
 * upload path.
 */
export async function isOfficeAttachmentsEnabled(
  event: Pick<RequestEvent, 'context'>,
  logger?: LoggerLike,
): Promise<boolean> {
  try {
    const resolution = await evaluateFeatureForEvent(
      event,
      OFFICE_ATTACHMENTS_FLAG,
    )

    return resolution.active
  } catch (exception) {
    logger?.set({
      attributes: {
        files: {
          officeFlagError: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}

function resolveOfficeUploadType(
  fileName: string,
  declaredType: string | undefined,
): ResolvedUploadFileType | null {
  assertSupportedOfficeExtension(fileName)

  const officeFormat = getOfficeFormatByFileName(fileName)

  if (officeFormat) {
    return { mediaType: OFFICE_MEDIA_TYPES[officeFormat], officeFormat }
  }

  if (declaredType && isOfficeMediaType(declaredType)) {
    throw createOfficeRejection(
      'The file name must end in .docx, .xlsx or .pptx.',
      OFFICE_SAVE_AS_FIX,
    )
  }

  return null
}

/**
 * The one place that turns an upload's file name and declared type into the
 * stored media type, shared by both upload routes. With `files.office` off it
 * is the allowlist check the routes always had. With it on, an Office
 * extension decides the type (browsers send an empty type, `application/zip`
 * or `application/octet-stream` for these files), and legacy and
 * macro-enabled files are refused with a save-as hint. The declared type never
 * makes a file legacy: browsers send `application/vnd.ms-excel` for a `.csv`.
 */
export async function resolveUploadFileType(
  input: ResolveUploadFileTypeInput,
): Promise<ResolvedUploadFileType> {
  const { event, fileName, declaredType, logger } = input
  const isOfficeCandidate = looksLikeOfficeUpload(fileName, declaredType)
  const isOfficeEnabled = isOfficeCandidate
    ? await isOfficeAttachmentsEnabled(event, logger)
    : false

  if (isOfficeEnabled) {
    const officeType = resolveOfficeUploadType(fileName, declaredType)

    if (officeType) {
      return officeType
    }
  }

  if (!declaredType) {
    throw createError({
      message: 'Missing required headers',
      status: 400,
    })
  }

  const normalizedType = normalizeMediaType(declaredType)

  if (!normalizedType) {
    throw createError({
      message: 'Invalid file media type',
      status: 400,
    })
  }

  const config = useRuntimeConfig().public
  const allowedFileFormats = getAllowedFileFormats(
    config.allowedFileFormats as readonly string[],
    { office: isOfficeEnabled },
  )

  if (!allowedFileFormats.includes(normalizedType)) {
    throw createError({
      message: `File type must be one of: ${allowedFileFormats.join(', ')}`,
      status: 400,
    })
  }

  return { mediaType: normalizedType, officeFormat: null }
}
