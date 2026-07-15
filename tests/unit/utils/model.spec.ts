import type { Model } from '#shared/types/providers.d'
import { describe, expect, it } from 'vitest'
import google from '../../../providers/google'
import openai from '../../../providers/openai'
import {
  getControllerModelId,
  getImageGenerationModelId,
  getRequiredModelTools,
  isImageGenerationModel,
} from '../../../shared/utils/model'

const googleImageModelIds = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
]

function getConfiguredModel(modelId: string): Model {
  const model = [...openai.models, ...google.models].find((candidate) => {
    return candidate.id === modelId
  })

  if (!model) {
    throw new Error(`Missing model ${modelId}`)
  }

  return model as Model
}

describe('image generation models', () => {
  it('appends the current OpenAI image model without default tools', () => {
    const model = getConfiguredModel('gpt-image-2')

    expect(openai.models.at(-1)?.id).toBe('gpt-image-2')
    expect(model.tools).toEqual([])
    expect(model.modalities.output).toEqual(['image'])
    expect(model.price.display).toContain('/ medium image')
    expect(getControllerModelId(model)).toBe('gpt-5-nano')
    expect(getRequiredModelTools(model)).toEqual(['image_generation'])
  })

  it('appends current Google image models in the documented order', () => {
    const appendedIds = google.models
      .slice(-googleImageModelIds.length)
      .map(model => model.id)

    expect(appendedIds).toEqual(googleImageModelIds)

    for (const modelId of googleImageModelIds) {
      const model = getConfiguredModel(modelId)

      expect(model.tools).toEqual([])
      expect(model.imageGeneration).toEqual({
        controllerModel: 'gemini-2.5-flash-lite',
      })
      expect(model.price.display).toContain('/ ')
    }
  })

  it('does not add deprecated or video generation models', () => {
    const configuredIds = [...openai.models, ...google.models]
      .map(model => model.id)

    expect(configuredIds).not.toContain('gpt-image-1.5')
    expect(configuredIds.some(id => /veo|video|omni/i.test(id))).toBe(false)
    expect(configuredIds.some(id => id.startsWith('imagen-'))).toBe(false)
  })

  it('keeps regular models on their own controller and image fallback', () => {
    const model = getConfiguredModel('gpt-5-mini')

    expect(isImageGenerationModel(model)).toBe(false)
    expect(getRequiredModelTools(model)).toEqual([])
    expect(getControllerModelId(model)).toBe('gpt-5-mini')
    expect(getImageGenerationModelId(model, 'gpt-image-2'))
      .toBe('gpt-image-2')
  })

  it('uses the selected image model for generation', () => {
    const model = getConfiguredModel('gemini-3-pro-image')

    expect(isImageGenerationModel(model)).toBe(true)
    expect(getImageGenerationModelId(
      model,
      'gemini-3.1-flash-image',
    )).toBe('gemini-3-pro-image')
  })

  it('handles an unresolved model gracefully', () => {
    expect(isImageGenerationModel(null)).toBe(false)
    expect(isImageGenerationModel(undefined)).toBe(false)
    expect(getRequiredModelTools(null)).toEqual([])
    expect(getImageGenerationModelId(null, 'gpt-image-2'))
      .toBe('gpt-image-2')
  })

  it('points every controllerModel reference at a real catalog entry', () => {
    const modelIds = new Set(
      [...openai.models, ...google.models].map(model => model.id),
    )
    const imageModels = [...openai.models, ...google.models].filter(
      model => model.imageGeneration,
    )

    expect(imageModels.length).toBeGreaterThan(0)

    for (const model of imageModels) {
      expect(modelIds.has(model.imageGeneration!.controllerModel)).toBe(true)
    }
  })
})
