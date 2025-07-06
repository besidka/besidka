// import anthropic from './anthropic'
import google from './google'
import openai from './openai'

export const providers = [
  // @TODO Anthropic is under development yet
  // anthropic,
  google,
  openai,
]

const defaultFirstFoundModel = providers[0]?.models[0]?.id
let defaultMarkedModel: string = ''

for (const provider of providers) {
  for (const model of provider.models) {
    // @ts-expect-error
    if (model.default) {
      defaultMarkedModel = model.id
      break
    }
  }
}

export const defaultModel = defaultMarkedModel ?? defaultFirstFoundModel
