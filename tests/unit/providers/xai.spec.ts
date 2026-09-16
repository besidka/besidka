import { describe, expect, it } from 'vitest'
import xai from '../../../providers/xai'
import snapshot from '../../../providers/data/models-dev-snapshot.json'
import { parseModelFamily } from '../../../scripts/detect-model-successors.mjs'

const expectedModelIds = [
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-4.6',
  'grok-4.5',
  'grok-4.3',
  'grok-build-0.1',
  'grok-imagine-image-2.0',
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.20-0309-non-reasoning': ['web_search'],
  'grok-4.20-0309-reasoning': ['web_search'],
  'grok-4.20-multi-agent-0309': [],
  'grok-4.6': ['web_search'],
  'grok-4.5': ['web_search'],
  'grok-4.3': ['web_search'],
  'grok-build-0.1': ['web_search'],
  'grok-imagine-image-2.0': [],
}

describe('curated xai provider', () => {
  it('curates exactly the eight expected models', () => {
    const ids = xai.models.map(model => model.id)

    expect(xai.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('lists the non-reasoning model first as the recommended default', () => {
    expect(xai.models[0]?.id).toBe('grok-4.20-0309-non-reasoning')
  })

  it('has no model marked as the app-wide default', () => {
    for (const model of xai.models) {
      expect(model.default).toBeFalsy()
    }
  })

  it('has no model marked for project memory', () => {
    for (const model of xai.models) {
      expect(model.forProjectMemory).toBeFalsy()
    }
  })

  it('exposes image generation on exactly grok-imagine-image-2.0, last '
    + 'in the array, controlled by the cheapest non-reasoning chat model',
  () => {
    const modelsWithImageGeneration = xai.models.filter((model) => {
      return model.imageGeneration !== undefined
    })

    expect(modelsWithImageGeneration).toHaveLength(1)
    expect(modelsWithImageGeneration[0]?.id).toBe('grok-imagine-image-2.0')
    expect(xai.models.at(-1)?.id).toBe('grok-imagine-image-2.0')

    const controllerModelId
      = modelsWithImageGeneration[0]?.imageGeneration?.controllerModel

    expect(controllerModelId).toBe('grok-4.20-0309-non-reasoning')
    expect(xai.models.map(model => model.id))
      .toContain(controllerModelId)
    expect(modelsWithImageGeneration[0]?.tools).toEqual([])
  })

  it('has no model configured as a deep-research agent', () => {
    for (const model of xai.models) {
      expect(model.research).toBeUndefined()
    }
  })

  it('gives each model the tools it is entitled to', () => {
    for (const model of xai.models) {
      expect(model.tools).toEqual(expectedToolsById[model.id])
    }
  })

  it('gives grok-4.6, grok-4.5, grok-4.3 and '
    + 'grok-4.20-multi-agent-0309 adjustable reasoning levels', () => {
    const leveledIds = [
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
      'grok-4.20-multi-agent-0309',
    ]

    for (const id of leveledIds) {
      const model = xai.models.find(candidate => candidate.id === id)

      expect(model?.reasoning).toEqual({
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      })
    }
  })

  it('marks grok-4.20-0309-reasoning and grok-build-0.1 as always-on '
    + 'reasoning rather than toggleable or leveled', () => {
    const alwaysOnIds = ['grok-4.20-0309-reasoning', 'grok-build-0.1']

    for (const id of alwaysOnIds) {
      const model = xai.models.find(candidate => candidate.id === id)

      expect(model?.reasoningAlwaysOn).toBe(true)
      expect(model?.reasoning).toBeUndefined()
    }
  })

  it('gives grok-4.20-0309-non-reasoning neither adjustable reasoning '
    + 'levels nor always-on reasoning', () => {
    const model = xai.models.find((candidate) => {
      return candidate.id === 'grok-4.20-0309-non-reasoning'
    })

    expect(model?.reasoning).toBeUndefined()
    expect(model?.reasoningAlwaysOn).toBeUndefined()
  })

  it('orders the grok-{v} family newest-first', () => {
    const familyIds = ['grok-4.6', 'grok-4.5', 'grok-4.3']

    for (const id of familyIds) {
      expect(parseModelFamily(id)?.family).toBe('grok-{v}')
    }

    const indexes = familyIds.map((id) => {
      return xai.models.findIndex(model => model.id === id)
    })

    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('has a models.dev snapshot entry for every curated id except the '
    + 'exempt image model', () => {
    const snapshotIds = Object.keys(snapshot)
    const idsWithSnapshotEntries = expectedModelIds.filter((id) => {
      return id !== 'grok-imagine-image-2.0'
    })

    for (const id of idsWithSnapshotEntries) {
      expect(snapshotIds).toContain(id)
    }

    expect(snapshotIds).not.toContain('grok-imagine-image-2.0')
  })

  it('fully hand-curates grok-imagine-image-2.0 since it has no '
    + 'models.dev snapshot entry', () => {
    const model = xai.models.find((candidate) => {
      return candidate.id === 'grok-imagine-image-2.0'
    })

    expect(model?.name).toBe('Grok Imagine Image 2.0')
    expect(model?.description).toBeTruthy()
    expect(model?.contextLength).toBe(64_000)
    expect(model?.maxOutputTokens).toBe(0)
    expect(model?.modalities).toEqual({
      input: ['text', 'image', 'pdf'],
      output: ['image'],
    })
  })
})
