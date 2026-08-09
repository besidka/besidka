import { describe, expect, it } from 'vitest'
import xai from '../../../providers/xai'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.5',
]

describe('curated xai provider', () => {
  it('curates exactly the three expected models', () => {
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

  it('exposes web search on every model', () => {
    for (const model of xai.models) {
      expect(model.tools).toContain('web_search')
    }
  })

  it('only gives grok-4.5 adjustable reasoning levels', () => {
    const grok45 = xai.models.find(model => model.id === 'grok-4.5')
    const nonReasoning = xai.models.find((model) => {
      return model.id === 'grok-4.20-0309-non-reasoning'
    })
    const reasoning = xai.models.find((model) => {
      return model.id === 'grok-4.20-0309-reasoning'
    })

    expect(grok45?.reasoning).toEqual({
      mode: 'levels',
      levels: ['low', 'medium', 'high'],
    })
    expect(nonReasoning?.reasoning).toBeUndefined()
    expect(reasoning?.reasoning).toBeUndefined()
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
