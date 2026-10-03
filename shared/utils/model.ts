import type {
  Provider,
  Model,
  ModelTool,
} from '#shared/types/providers.d'
import type { ImageGenerationProvider } from '#shared/types/image-generation.d'

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

// The single source of truth for which providers can generate images,
// derived from the curated catalog instead of a hand-maintained literal
// union. A provider only ever gets a `generate_image` tool wired up
// (server/api/v1/chats/[slug]/index.post.ts) when one of its models
// declares `imageGeneration`, so scanning for exactly that is enough to
// reconstruct the same set everywhere a runtime check needs it.
export function getImageGenerationProviders(): ImageGenerationProvider[] {
  const { providers } = getProviders()
  const providerIds = new Set<ImageGenerationProvider>()

  for (const provider of providers) {
    const hasImageGenerationModel = provider.models.some((model) => {
      return isImageGenerationModel(model)
    })

    if (hasImageGenerationModel) {
      providerIds.add(provider.id as ImageGenerationProvider)
    }
  }

  return [...providerIds]
}
