import type { Model, Provider, Providers } from '#shared/types/providers.d'

export type CatalogModel = Pick<
  Model,
  | 'id'
  | 'name'
  | 'description'
  | 'contextLength'
  | 'maxOutputTokens'
  | 'releaseDate'
  | 'status'
  | 'retiredAt'
  | 'price'
  | 'priceTier'
  | 'modalities'
  | 'tools'
  | 'toolCall'
  | 'reasoning'
  | 'reasoningAlwaysOn'
  | 'imageGeneration'
>

export interface CatalogProvider {
  id: Provider['id']
  name: Provider['name']
  models: CatalogModel[]
}

export interface ListCatalogOptions {
  providerId?: string
  includeDeprecated?: boolean
}

export function toCatalogModel(model: Model): CatalogModel {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    releaseDate: model.releaseDate,
    status: model.status,
    retiredAt: model.retiredAt,
    price: model.price,
    priceTier: model.priceTier,
    modalities: model.modalities,
    tools: model.tools,
    toolCall: model.toolCall,
    reasoning: model.reasoning,
    reasoningAlwaysOn: model.reasoningAlwaysOn,
    imageGeneration: model.imageGeneration,
  }
}

export function listCatalog(
  providers: Providers,
  options: ListCatalogOptions = {},
): CatalogProvider[] {
  const { providerId, includeDeprecated = false } = options

  return providers
    .filter((provider) => {
      return !providerId || provider.id === providerId
    })
    .map((provider) => {
      const models = provider.models
        .filter((model) => {
          return includeDeprecated || model.status !== 'deprecated'
        })
        .map(toCatalogModel)

      return {
        id: provider.id,
        name: provider.name,
        models,
      }
    })
}
