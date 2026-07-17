import type {
  Provider,
  Model,
  ModelTool,
} from '#shared/types/providers.d'

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

export function isImageGenerationModel(
  model: Model | null | undefined,
): boolean {
  return !!model?.imageGeneration
}

export function getRequiredModelTools(
  model: Model | null | undefined,
): ModelTool[] {
  if (!isImageGenerationModel(model)) {
    return []
  }

  return ['image_generation']
}

export function getControllerModelId(model: Model): string {
  return model.imageGeneration?.controllerModel ?? model.id
}

export function getImageGenerationModelId(
  model: Model | null | undefined,
  fallbackModelId: string,
): string {
  if (!isImageGenerationModel(model)) {
    return fallbackModelId
  }

  return model?.id ?? fallbackModelId
}
