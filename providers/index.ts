import type { Providers } from '../shared/types/providers.d'
import type { ModelSnapshot } from './merge'
import snapshot from './data/models-dev-snapshot.json'
import { mergeProvider } from './merge'
import anthropic from './anthropic'
import google from './google'
import openai from './openai'

const curatedProviders = [
  anthropic,
  google,
  openai,
]

export const providers: Providers = curatedProviders.map((provider) => {
  return mergeProvider(provider, snapshot as ModelSnapshot)
})

const defaultFirstFoundModel = providers[0]?.models[0]?.id
let defaultMarkedModel: string = ''

for (const provider of providers) {
  for (const model of provider.models) {
    if (model.default) {
      defaultMarkedModel = model.id
      break
    }
  }
}

export const defaultModel = defaultMarkedModel ?? defaultFirstFoundModel
