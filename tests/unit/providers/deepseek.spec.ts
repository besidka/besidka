import { describe, expect, it } from 'vitest'
import deepseek from '../../../providers/deepseek'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'deepseek-chat',
  'deepseek-reasoner',
]

describe('curated deepseek provider', () => {
  it('curates exactly the two expected models', () => {
    const ids = deepseek.models.map(model => model.id)

    expect(deepseek.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('lists deepseek-chat first as the recommended default', () => {
    expect(deepseek.models[0]?.id).toBe('deepseek-chat')
  })

  it('has no model marked as the app-wide default', () => {
    for (const model of deepseek.models) {
      expect(model.default).toBeFalsy()
    }
  })

  it('has no model marked for project memory', () => {
    for (const model of deepseek.models) {
      expect(model.forProjectMemory).toBeFalsy()
    }
  })

  it('has no model exposing any tool', () => {
    for (const model of deepseek.models) {
      expect(model.tools).toEqual([])
      expect(model.imageGeneration).toBeUndefined()
    }
  })

  it('has no model configured as a deep-research agent', () => {
    for (const model of deepseek.models) {
      expect(model.research).toBeUndefined()
    }
  })

  it('gives deepseek-chat a toggle-only reasoning capability', () => {
    const chat = deepseek.models.find(model => model.id === 'deepseek-chat')

    expect(chat?.reasoning).toEqual({ mode: 'toggle' })
  })

  it('gives deepseek-reasoner levels-based reasoning with low/medium/high', () => {
    const reasoner = deepseek.models.find((model) => {
      return model.id === 'deepseek-reasoner'
    })

    expect(reasoner?.reasoning).toEqual({
      mode: 'levels',
      levels: ['low', 'medium', 'high'],
    })
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
