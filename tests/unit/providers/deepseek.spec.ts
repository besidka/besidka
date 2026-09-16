import { describe, expect, it } from 'vitest'
import deepseek from '../../../providers/deepseek'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'deepseek-flash',
  'deepseek-v4-pro',
]

describe('curated deepseek provider', () => {
  it('curates exactly the two expected models', () => {
    const ids = deepseek.models.map(model => model.id)

    expect(deepseek.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('lists deepseek-flash first as the recommended default', () => {
    expect(deepseek.models[0]?.id).toBe('deepseek-flash')
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

  it('gives every curated model a toggle-only reasoning capability', () => {
    for (const model of deepseek.models) {
      expect(model.reasoning).toEqual({ mode: 'toggle' })
    }
  })

  it('no longer curates the retired deepseek-chat/deepseek-reasoner aliases', () => {
    const ids = deepseek.models.map(model => model.id)

    expect(ids).not.toContain('deepseek-chat')
    expect(ids).not.toContain('deepseek-reasoner')
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
