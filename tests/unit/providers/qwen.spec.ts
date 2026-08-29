import { describe, expect, it } from 'vitest'
import qwen from '../../../providers/qwen'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3.6-flash',
]

describe('curated qwen provider', () => {
  it('curates exactly the three expected models', () => {
    const ids = qwen.models.map(model => model.id)

    expect(qwen.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('lists qwen3.7-plus first as the recommended default', () => {
    expect(qwen.models[0]?.id).toBe('qwen3.7-plus')
  })

  it('has no model marked as the app-wide default', () => {
    for (const model of qwen.models) {
      expect(model.default).toBeFalsy()
    }
  })

  it('has no model marked for project memory', () => {
    for (const model of qwen.models) {
      expect(model.forProjectMemory).toBeFalsy()
    }
  })

  it('declares web search on exactly the models whose chat-completions '
    + 'support DashScope documents for the international endpoint', () => {
    const toolsById = new Map(
      qwen.models.map(model => [model.id, model.tools]),
    )

    expect(toolsById.get('qwen3.7-plus')).toEqual(['web_search'])
    expect(toolsById.get('qwen3.6-flash')).toEqual(['web_search'])
    expect(toolsById.get('qwen3.7-max')).toEqual([])
  })

  it('has no model exposing image generation', () => {
    for (const model of qwen.models) {
      expect(model.tools).not.toContain('image_generation')
      expect(model.imageGeneration).toBeUndefined()
    }
  })

  it('has no model configured as a deep-research agent', () => {
    for (const model of qwen.models) {
      expect(model.research).toBeUndefined()
    }
  })

  it('gives every curated model a toggle-only reasoning capability', () => {
    for (const model of qwen.models) {
      expect(model.reasoning).toEqual({ mode: 'toggle' })
      expect(model.reasoningAlwaysOn).toBeUndefined()
    }
  })

  it('points the models.dev lookup at the "alibaba" catalog key', () => {
    expect(qwen.modelsDevKey).toBe('alibaba')
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
