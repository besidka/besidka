import type { Providers } from '../shared/types/providers.d'
import type { ModelSnapshot } from './merge'
import snapshot from './data/models-dev-snapshot.json' with { type: 'json' }
import { mergeProvider } from './merge.ts'
import anthropic from './anthropic.ts'
import google from './google.ts'
import openai from './openai.ts'
import xai from './xai.ts'
import deepseek from './deepseek.ts'
import moonshotai from './moonshotai.ts'
import qwen from './qwen.ts'

const curatedProviders = [
  anthropic,
  google,
  openai,
  xai,
  deepseek,
  moonshotai,
  qwen,
]

export const providers: Providers = curatedProviders.map((provider) => {
  return mergeProvider(provider, snapshot as ModelSnapshot)
})

export function resolveDefaultMarkedModel(
  providersToScan: Providers,
): string | undefined {
  let defaultMarkedModel: string | undefined

  outer: for (const provider of providersToScan) {
    for (const model of provider.models) {
      if (model.default) {
        defaultMarkedModel = model.id
        break outer
      }
    }
  }

  return defaultMarkedModel
}

const defaultFirstFoundModel = providers[0]?.models[0]?.id

export const defaultModel = resolveDefaultMarkedModel(providers)
  ?? defaultFirstFoundModel
