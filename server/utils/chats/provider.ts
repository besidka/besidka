import type { Provider, Model } from '#shared/types/providers.d'
import { createError } from 'evlog'
import { assertModelNotDeprecated } from '~~/server/utils/chats/deprecated-model'

export function useChatProvider(
  userModel: string,
): {
  provider: Provider
  model: Model
  modelName: Model['name']
} {
  if (!userModel) {
    throw createError({
      message: 'Please select a model to continue.',
      status: 400,
    })
  }

  const { model, provider, modelName } = getModel(userModel)

  if (!provider || !model) {
    throw createError({
      message:
        'Current model is not supported by any provider. Please select a different model.',
      status: 400,
    })
  }

  assertModelNotDeprecated(model)

  return {
    provider,
    model,
    modelName,
  }
}
