import { describe, expect, it } from 'vitest'
import anthropic from '../../../providers/anthropic'
import google from '../../../providers/google'
import openai from '../../../providers/openai'
import {
  compareModelVersions,
  parseModelFamily,
} from '../../../scripts/detect-model-successors.mjs'

interface OrderableModel {
  id: string
  research?: unknown
  imageGeneration?: unknown
}

interface OrderingViolation {
  family: string
  earlierId: string
  laterId: string
}

function findOrderingViolations(
  models: OrderableModel[],
): OrderingViolation[] {
  const membersByFamily = new Map<string, { id: string, version: string }[]>()

  for (const model of models) {
    if (model.research || model.imageGeneration) {
      continue
    }

    const parsed = parseModelFamily(model.id)

    if (!parsed) {
      continue
    }

    const members = membersByFamily.get(parsed.family) ?? []

    members.push({ id: model.id, version: parsed.version })
    membersByFamily.set(parsed.family, members)
  }

  const violations: OrderingViolation[] = []

  for (const [family, members] of membersByFamily) {
    for (let index = 1; index < members.length; index++) {
      const earlier = members[index - 1]
      const later = members[index]

      if (compareModelVersions(later.version, earlier.version) > 0) {
        violations.push({
          family,
          earlierId: earlier.id,
          laterId: later.id,
        })
      }
    }
  }

  return violations
}

describe('findOrderingViolations', () => {
  it('flags each adjacent pair that breaks newest-first order', () => {
    const buggyFlashFamily: OrderableModel[] = [
      { id: 'gemini-3.6-flash' },
      { id: 'gemini-3.7-flash' },
      { id: 'gemini-3.8-flash' },
      { id: 'gemini-3.5-flash' },
    ]

    const violations = findOrderingViolations(buggyFlashFamily)

    expect(violations).toHaveLength(2)
    expect(violations).toEqual([
      {
        family: 'gemini-{v}-flash',
        earlierId: 'gemini-3.6-flash',
        laterId: 'gemini-3.7-flash',
      },
      {
        family: 'gemini-{v}-flash',
        earlierId: 'gemini-3.7-flash',
        laterId: 'gemini-3.8-flash',
      },
    ])
  })

  it('reports nothing for a family already in descending order', () => {
    const correctFlashFamily: OrderableModel[] = [
      { id: 'gemini-3.8-flash' },
      { id: 'gemini-3.7-flash' },
      { id: 'gemini-3.6-flash' },
      { id: 'gemini-3.5-flash' },
    ]

    expect(findOrderingViolations(correctFlashFamily)).toEqual([])
  })

  it('never compares members across different families', () => {
    const unrelatedFamilies: OrderableModel[] = [
      { id: 'gemini-3.8-flash' },
      { id: 'gemini-3.5-flash-lite' },
      { id: 'gemini-3.6-flash' },
    ]

    expect(findOrderingViolations(unrelatedFamilies)).toEqual([])
  })

  it('ignores models with a research field when grouping', () => {
    const withResearchModel: OrderableModel[] = [
      {
        id: 'gemini-2.5-flash',
        research: { tier: 'thorough' },
      },
      { id: 'gemini-3.5-flash' },
    ]

    expect(findOrderingViolations(withResearchModel)).toEqual([])
  })

  it('ignores models with an imageGeneration field when grouping', () => {
    const withImageGenerationModel: OrderableModel[] = [
      {
        id: 'gemini-2.5-flash',
        imageGeneration: { controllerModel: 'gemini-2.5-flash-lite' },
      },
      { id: 'gemini-3.5-flash' },
    ]

    expect(findOrderingViolations(withImageGenerationModel)).toEqual([])
  })

  it('ignores ids that parseModelFamily cannot version', () => {
    const undatedIds: OrderableModel[] = [
      { id: 'gemini-flash-latest' },
      { id: 'gemini-omni-flash-preview' },
    ]

    expect(findOrderingViolations(undatedIds)).toEqual([])
  })
})

describe('curated provider ordering', () => {
  it('keeps anthropic families in newest-first order', () => {
    expect(findOrderingViolations(anthropic.models)).toEqual([])
  })

  it('keeps google families in newest-first order', () => {
    expect(findOrderingViolations(google.models)).toEqual([])
  })

  it('keeps openai families in newest-first order', () => {
    expect(findOrderingViolations(openai.models)).toEqual([])
  })
})
