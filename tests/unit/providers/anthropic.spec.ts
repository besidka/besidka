import { describe, expect, it } from 'vitest'
import anthropic from '../../../providers/anthropic'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
]

describe('curated anthropic provider', () => {
  it('curates exactly the nine expected models', () => {
    const ids = anthropic.models.map(model => model.id)

    expect(anthropic.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('has no model marked as the app-wide default', () => {
    for (const model of anthropic.models) {
      expect(model.default).toBeFalsy()
    }
  })

  it('has no model marked for project memory', () => {
    for (const model of anthropic.models) {
      expect(model.forProjectMemory).toBeFalsy()
    }
  })

  it('has no model exposing image generation', () => {
    for (const model of anthropic.models) {
      expect(model.tools).not.toContain('image_generation')
      expect(model.imageGeneration).toBeUndefined()
    }
  })

  it('has no model configured as a deep-research agent', () => {
    for (const model of anthropic.models) {
      expect(model.research).toBeUndefined()
    }
  })

  it('gives every model levels-based reasoning with low/medium/high', () => {
    for (const model of anthropic.models) {
      expect(model.reasoning).toBeDefined()
      expect(model.reasoning?.mode).toBe('levels')

      const levels = model.reasoning?.mode === 'levels'
        ? [...model.reasoning.levels].sort()
        : []

      expect(levels).toEqual(['high', 'low', 'medium'])
    }
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
