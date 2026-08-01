import type { Provider, Model } from '#shared/types/providers.d'
import { createError as createEvlogError } from 'evlog'

export function useChatProvider(
  userModel: string,
): {
  provider: Provider
  model: Model
  modelName: Model['name']
} {
  if (!userModel) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Please select a model to continue.',
    })
  }

  const { model, provider, modelName } = getModel(userModel)

  if (!provider || !model) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Current model is not supported by any provider. Please select a different model.',
    })
  }

  if (model.status === 'deprecated') {
    throw createEvlogError({
      message: 'This model is no longer available.',
      status: 400,
      why: `${model.name} is deprecated and can no longer be used for new`
        + ' requests.',
      fix: 'Choose a different model from the picker.',
    })
  }

  return {
    provider,
    model,
    modelName,
  }
}
