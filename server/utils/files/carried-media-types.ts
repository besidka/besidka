import { createInputMediaTypePredicate } from '#shared/utils/input-media-types'
import { isOfficeMediaType } from '#shared/utils/office-files'

/**
 * Office files are sent as extracted text, so every model can carry them;
 * whether a given file has readable text is decided per file, not here.
 */
export function createCarriedMediaTypePredicate(
  inputModalities: readonly string[],
): (mediaType: string) => boolean {
  const canCarryByModalities = createInputMediaTypePredicate(inputModalities)

  return (mediaType) => {
    return isOfficeMediaType(mediaType) || canCarryByModalities(mediaType)
  }
}
