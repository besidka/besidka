import type { Provider, Model } from '#shared/types/providers.d'

export function getModel(modelId: string): {
  modelName: Model['name']
  model: Model | null
  provider: Provider | null
} {
  const { providers } = getProviders()
  const emptyTitle = 'Select Model'
  let modelName: Model['name'] | null = null
  let model: Model | null = null
  let provider: Provider | null = null

  for (const p of providers) {
    for (const m of p.models) {
      if (m.id !== modelId) {
        continue
      }

      modelName = m.name
      model = m
      provider = p
      break
    }
  }

  return {
    modelName: modelName ?? emptyTitle,
    model,
    provider,
  }
}

export function getModelName(
  modelId: string,
): Model['name'] {
  const { modelName } = getModel(modelId)

  return modelName
}
