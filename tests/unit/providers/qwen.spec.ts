import { describe, expect, it } from 'vitest'
import qwen from '../../../providers/qwen'
import snapshot from '../../../providers/data/models-dev-snapshot.json'

const expectedModelIds = [
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3.6-flash',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3.6-27b',
  'qwen3.6-35b-a3b',
  'qwen3.5-plus',
  'qwen3.5-397b-a17b',
  'qwen3.5-122b-a10b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3-vl-plus',
  'qwen3-235b-a22b',
  'qwen3-32b',
  'qwen3-14b',
  'qwen3-8b',
  'qwen-plus',
  'qwen-flash',
  'qwen-turbo',
  'qwq-plus',
  'qvq-max',
  'qwen3-next-80b-a3b-thinking',
  'qwen3-vl-235b-a22b',
  'qwen3-vl-30b-a3b',
  'qwen3-max',
  'qwen3-next-80b-a3b-instruct',
  'qwen3-coder-plus',
  'qwen3-coder-flash',
  'qwen3-coder-480b-a35b-instruct',
  'qwen3-coder-30b-a3b-instruct',
  'qwen-max',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen-vl-ocr',
  'qwen-plus-character-ja',
  'qwen-mt-plus',
  'qwen-mt-turbo',
  'qwen2-5-vl-72b-instruct',
  'qwen2-5-vl-7b-instruct',
  'qwen2-5-72b-instruct',
  'qwen2-5-32b-instruct',
  'qwen2-5-14b-instruct',
  'qwen2-5-7b-instruct',
]

const toggleReasoningIds = [
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3.6-flash',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3.6-27b',
  'qwen3.6-35b-a3b',
  'qwen3.5-plus',
  'qwen3.5-397b-a17b',
  'qwen3.5-122b-a10b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3-vl-plus',
  'qwen3-235b-a22b',
  'qwen3-32b',
  'qwen3-14b',
  'qwen3-8b',
  'qwen-plus',
  'qwen-flash',
  'qwen-turbo',
]

const reasoningAlwaysOnIds = [
  'qwq-plus',
  'qvq-max',
  'qwen3-next-80b-a3b-thinking',
  'qwen3-vl-235b-a22b',
  'qwen3-vl-30b-a3b',
]

const noReasoningIds = [
  'qwen3-max',
  'qwen3-next-80b-a3b-instruct',
  'qwen3-coder-plus',
  'qwen3-coder-flash',
  'qwen3-coder-480b-a35b-instruct',
  'qwen3-coder-30b-a3b-instruct',
  'qwen-max',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen-vl-ocr',
  'qwen-plus-character-ja',
  'qwen-mt-plus',
  'qwen-mt-turbo',
  'qwen2-5-vl-72b-instruct',
  'qwen2-5-vl-7b-instruct',
  'qwen2-5-72b-instruct',
  'qwen2-5-32b-instruct',
  'qwen2-5-14b-instruct',
  'qwen2-5-7b-instruct',
]

function findModel(id: string) {
  return qwen.models.find(model => model.id === id)
}

describe('curated qwen provider', () => {
  it('curates exactly the 46 expected models', () => {
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

  it('declares web search only on the two models verified against '
    + 'DashScope docs for the international endpoint — every other model, '
    + 'including all 43 newly added ones, ships unverified-by-default', () => {
    const toolsById = new Map(
      qwen.models.map(model => [model.id, model.tools]),
    )

    for (const model of qwen.models) {
      if (model.id === 'qwen3.7-plus' || model.id === 'qwen3.6-flash') {
        expect(toolsById.get(model.id)).toEqual(['web_search'])
      } else {
        expect(toolsById.get(model.id)).toEqual([])
      }
    }
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

  it('gives every toggle-capable model a toggle-only reasoning capability',
    () => {
      for (const id of toggleReasoningIds) {
        const model = findModel(id)

        expect(model).toBeDefined()
        expect(model?.reasoning).toEqual({ mode: 'toggle' })
        expect(model?.reasoningAlwaysOn).toBeUndefined()
      }
    })

  it('marks every always-thinking model as reasoningAlwaysOn with no '
    + 'reasoning object', () => {
    for (const id of reasoningAlwaysOnIds) {
      const model = findModel(id)

      expect(model).toBeDefined()
      expect(model?.reasoningAlwaysOn).toBe(true)
      expect(model?.reasoning).toBeUndefined()
    }
  })

  it('gives every non-reasoning model no reasoning field at all', () => {
    for (const id of noReasoningIds) {
      const model = findModel(id)

      expect(model).toBeDefined()
      expect(model?.reasoning).toBeUndefined()
      expect(model?.reasoningAlwaysOn).toBeUndefined()
    }
  })

  it('partitions every curated model into exactly one of the three '
    + 'reasoning groups', () => {
    expect(toggleReasoningIds).toHaveLength(22)
    expect(reasoningAlwaysOnIds).toHaveLength(5)
    expect(noReasoningIds).toHaveLength(19)

    const union = new Set([
      ...toggleReasoningIds,
      ...reasoningAlwaysOnIds,
      ...noReasoningIds,
    ])

    expect(union).toEqual(new Set(expectedModelIds))
  })

  it('points the models.dev lookup at the "alibaba" catalog key', () => {
    expect(qwen.modelsDevKey).toBe('alibaba')
  })

  it('never curates Alibaba-hosted third-party model ids, which would '
    + 'collide in the flat, provider-less id keyspace getModel() scans', () => {
    const ids = qwen.models.map(model => model.id)

    expect(ids).not.toContain('deepseek-v4-flash-0731')
    expect(ids).not.toContain('glm-5.2')
    expect(ids).not.toContain('kimi-k3')
  })

  it('never curates a model that outputs audio or video', () => {
    for (const model of qwen.models) {
      const outputModalities = model.modalities?.output ?? []

      expect(outputModalities).not.toContain('audio')
      expect(outputModalities).not.toContain('video')
    }
  })

  it('has a models.dev snapshot entry for every curated id', () => {
    const snapshotIds = Object.keys(snapshot)

    for (const id of expectedModelIds) {
      expect(snapshotIds).toContain(id)
    }
  })
})
