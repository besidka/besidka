import { createError } from 'evlog'
import { isHiddenFilePart } from '#shared/utils/files'
import { getInputMediaKind } from '#shared/utils/input-media-types'

type UnsupportedInputFileKind = 'image' | 'pdf'

interface InputFilePart {
  type: string
  mediaType?: string
}

/**
 * Returns the kind of the first image or PDF part the model cannot read, or
 * `undefined` when every such part is deliverable. `inputModalities` uses the
 * curated catalog vocabulary (`image`, `pdf`). Text files are always allowed
 * because they are inlined as text before the provider call, and other types
 * are governed by `validateMessageFilePolicy()`, not by model modalities.
 */
export function findUnsupportedInputFileKind(
  parts: readonly InputFilePart[],
  inputModalities: readonly string[],
): UnsupportedInputFileKind | undefined {
  for (const part of parts) {
    if (
      part.type !== 'file'
      || typeof part.mediaType !== 'string'
      || isHiddenFilePart(part)
    ) {
      continue
    }

    const kind = getInputMediaKind(part.mediaType)

    if (
      (kind === 'image' || kind === 'pdf')
      && !inputModalities.includes(kind)
    ) {
      return kind
    }
  }

  return undefined
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

export function createUnsupportedImageInputError(modelName: string) {
  return createError({
    message: `${modelName} does not support image input.`,
    status: 400,
    why: 'The message includes an image attachment, but the selected model does not advertise image support.',
    fix: 'Remove the image attachment, or switch to a vision-capable model.',
  })
}

function createUnsupportedInputFileError(
  kind: UnsupportedInputFileKind,
  modelName: string,
) {
  if (kind === 'image') {
    return createUnsupportedImageInputError(modelName)
  }

  return createError({
    message: `${modelName} does not support PDF input.`,
    status: 400,
    why: 'The message includes a PDF attachment, but the selected model does not advertise PDF support.',
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

  const unsupportedKind = findUnsupportedInputFileKind(
    parts,
    inputModalities,
  )

  if (unsupportedKind) {
    throw createUnsupportedInputFileError(unsupportedKind, modelName)
  }
}
