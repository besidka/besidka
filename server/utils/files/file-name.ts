import { createError } from 'evlog'
import {
  hasControlCharacters,
  hasFormatCharacters,
} from '#shared/utils/invisible-characters'

export function assertFileNameCharacters(name: string): void {
  if (hasFormatCharacters(name)) {
    throw createError({
      message: 'File name contains invisible formatting characters',
      status: 400,
      why: 'Bidirectional and zero-width characters can disguise a name',
      fix: 'Remove the invisible characters from the file name',
    })
  }

  if (hasControlCharacters(name)) {
    throw createError({
      message: 'File name contains control characters',
      status: 400,
      why: 'Control characters cannot be displayed in a name',
      fix: 'Remove the control characters from the file name',
    })
  }
}
