import { createError } from 'evlog'
import { isHiddenFilePart } from '#shared/utils/files'
import { resolveFileDelivery } from '#shared/utils/file-delivery'
import { getInputMediaKind } from '#shared/utils/input-media-types'

type UnsupportedInputFileKind = 'image' | 'pdf'

interface InputFilePart {
  type: string
  mediaType?: string
  filename?: string
}

interface UnsupportedInputFile {
  kind: UnsupportedInputFileKind
  filename?: string
}

function findUnsupportedInputFile(
  parts: readonly InputFilePart[],
  inputModalities: readonly string[],
): UnsupportedInputFile | undefined {
  for (const part of parts) {
    if (
      part.type !== 'file'
      || typeof part.mediaType !== 'string'
      || isHiddenFilePart(part)
    ) {
      continue
    }

    const { delivery, reason } = resolveFileDelivery({
      route: 'direct',
      modalities: inputModalities,
      mediaType: part.mediaType,
    })

    if (delivery !== 'unsupported') {
      continue
    }

    if (reason === 'model-no-image') {
      return { kind: 'image', filename: part.filename }
    }

    if (reason === 'model-no-pdf') {
      return { kind: 'pdf', filename: part.filename }
    }
  }

  return undefined
}

/**
 * Returns the kind of the first image or PDF part the model cannot read, or
 * `undefined` when every such part is deliverable. `inputModalities` uses the
 * curated catalog vocabulary (`image`, `pdf`). It reads only the media type
 * the client declared; the file's own type, and so whether an Office file has
 * readable text, is checked against the database by
 * `assertFilesDeliverable()`.
 */
export function findUnsupportedInputFileKind(
  parts: readonly InputFilePart[],
  inputModalities: readonly string[],
): UnsupportedInputFileKind | undefined {
  return findUnsupportedInputFile(parts, inputModalities)?.kind
}

export function hasImageFilePart(
  parts: readonly InputFilePart[],
): boolean {
  return parts.some((part) => {
    return part.type === 'file'
      && typeof part.mediaType === 'string'
      && getInputMediaKind(part.mediaType) === 'image'
  })
}

function describeAffectedFile(filename: string | undefined): string {
  return filename ? ` File: ${filename}.` : ''
}

export function createUnsupportedImageInputError(
  modelName: string,
  filename?: string,
) {
  return createError({
    message: `${modelName} does not support image input.`,
    status: 400,
    why: `The message includes an image attachment, but the selected model does not advertise image support.${describeAffectedFile(filename)}`,
    fix: 'Remove the image attachment, or switch to a vision-capable model.',
  })
}

function createUnsupportedInputFileError(
  unsupported: UnsupportedInputFile,
  modelName: string,
) {
  if (unsupported.kind === 'image') {
    return createUnsupportedImageInputError(modelName, unsupported.filename)
  }

  return createError({
    message: `${modelName} does not support PDF input.`,
    status: 400,
    why: `The message includes a PDF attachment, but the selected model does not advertise PDF support.${describeAffectedFile(unsupported.filename)}`,
    fix: 'Remove the PDF, attach its text as a .txt file, or switch to a model that reads PDFs.',
  })
}

export function assertInputFilesSupported(
  parts: readonly InputFilePart[],
  inputModalities: readonly string[],
  modelName: string,
): void {
  if (!parts.some(part => part.type === 'file')) {
    return
  }

  const unsupported = findUnsupportedInputFile(parts, inputModalities)

  if (unsupported) {
    throw createUnsupportedInputFileError(unsupported, modelName)
  }
}
