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
]

const expectedToolsById: Record<string, string[]> = {
  'grok-4.20-0309-non-reasoning': ['web_search'],
  'grok-4.20-0309-reasoning': ['web_search'],
  'grok-4.20-multi-agent-0309': [],
  'grok-4.6': ['web_search'],
  'grok-4.5': ['web_search'],
  'grok-4.3': ['web_search'],
  'grok-build-0.1': ['web_search'],
}

describe('curated xai provider', () => {
  it('curates exactly the seven expected models', () => {
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

  it('has no model exposing image generation', () => {
    for (const model of xai.models) {
      expect(model.tools).not.toContain('image_generation')
      expect(model.imageGeneration).toBeUndefined()
    }
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

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
