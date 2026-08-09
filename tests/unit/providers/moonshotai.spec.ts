import { describe, expect, it } from 'vitest'
import moonshotai from '../../../providers/moonshotai'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'kimi-k2.6',
  'kimi-k3',
]

describe('curated moonshotai provider', () => {
  it('curates exactly the two expected models', () => {
    const ids = moonshotai.models.map(model => model.id)

    expect(moonshotai.models).toHaveLength(expectedModelIds.length)
    expect(new Set(ids)).toEqual(new Set(expectedModelIds))
  })

  it('no longer curates the sunset kimi-k2.5 model', () => {
    const ids = moonshotai.models.map(model => model.id)

    expect(ids).not.toContain('kimi-k2.5')
  })

  it('lists kimi-k2.6 first as the recommended default', () => {
    expect(moonshotai.models[0]?.id).toBe('kimi-k2.6')
  })

  it('does not curate the sunset moonshot-v1 line', () => {
    const ids = moonshotai.models.map(model => model.id)

    for (const id of ids) {
      expect(id.startsWith('moonshot-v1')).toBe(false)
    }
  })

  it('has no model marked as the app-wide default', () => {
    for (const model of moonshotai.models) {
      expect(model.default).toBeFalsy()
    }
  })

  it('has no model marked for project memory', () => {
    for (const model of moonshotai.models) {
      expect(model.forProjectMemory).toBeFalsy()
    }
  })

  it('has no model exposing any tool', () => {
    for (const model of moonshotai.models) {
      expect(model.tools).toEqual([])
      expect(model.imageGeneration).toBeUndefined()
    }
  })

  it('has no model configured as a deep-research agent', () => {
    for (const model of moonshotai.models) {
      expect(model.research).toBeUndefined()
    }
  })

  it('gives kimi-k2.6 a toggle-only reasoning capability', () => {
    const k26 = moonshotai.models.find(model => model.id === 'kimi-k2.6')

    expect(k26?.reasoning).toEqual({ mode: 'toggle' })
    expect(k26?.reasoningAlwaysOn).toBeUndefined()
  })

  it('curates kimi-k3 as always-on reasoning without a toggle', () => {
    const k3 = moonshotai.models.find(model => model.id === 'kimi-k3')

    expect(k3?.reasoning).toBeUndefined()
    expect(k3?.reasoningAlwaysOn).toBe(true)
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
