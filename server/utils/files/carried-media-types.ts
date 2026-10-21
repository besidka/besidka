import { createInputMediaTypePredicate } from '#shared/utils/input-media-types'

export function createCarriedMediaTypePredicate(
  inputModalities: readonly string[],
): (mediaType: string) => boolean {
  return createInputMediaTypePredicate(inputModalities)
}
