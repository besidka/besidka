import type { Model } from '#shared/types/providers.d'
import { createError } from 'evlog'

export function assertModelNotDeprecated(model: Model): void {
  if (model.status !== 'deprecated') {
    return
  }

  throw createError({
    message: 'This model is no longer available.',
    status: 400,
    why: `${model.name} is deprecated and can no longer be used for new`
      + ' requests.',
    fix: 'Choose a different model from the picker.',
  })
}
