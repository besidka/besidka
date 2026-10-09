import { normalizeMediaType } from '#shared/utils/files'

export function createCarriedMediaTypePredicate(
  inputModalities: readonly string[],
): (mediaType: string) => boolean {
  return (mediaType) => {
    const normalizedMediaType = normalizeMediaType(mediaType)

    if (normalizedMediaType.startsWith('text/')) {
      return true
    }

    if (normalizedMediaType.startsWith('image/')) {
      return inputModalities.includes('image')
    }

    if (normalizedMediaType === 'application/pdf') {
      return inputModalities.includes('pdf')
    }

    return false
  }
}
