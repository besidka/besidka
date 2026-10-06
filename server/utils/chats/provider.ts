import type { Provider, Model } from '#shared/types/providers.d'
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

  assertModelNotDeprecated(model)

  return {
    provider,
    model,
    modelName,
  }
}
