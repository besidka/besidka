import { normalizeMediaType } from '#shared/utils/files'

export type InputMediaKind = 'text' | 'image' | 'pdf' | 'other'

export function getInputMediaKind(mediaType: string): InputMediaKind {
  const normalizedMediaType = normalizeMediaType(mediaType)

  if (normalizedMediaType.startsWith('text/')) {
    return 'text'
  }

  if (normalizedMediaType.startsWith('image/')) {
    return 'image'
  }

  if (normalizedMediaType === 'application/pdf') {
    return 'pdf'
  }

  return 'other'
}

export function createInputMediaTypePredicate(
  inputModalities: readonly string[],
): (mediaType: string) => boolean {
  return (mediaType) => {
    const kind = getInputMediaKind(mediaType)

    if (kind === 'text') {
      return true
    }

    if (kind === 'other') {
      return false
    }

    return inputModalities.includes(kind)
  }
}
