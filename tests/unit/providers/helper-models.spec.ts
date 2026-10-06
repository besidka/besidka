import { describe, expect, it } from 'vitest'
import { providers } from '../../../providers'

interface HelperModelReference {
  providerId: string
  referencingModelId: string
  referenceKind: 'controllerModel' | 'assistModel'
  helperModelId: string
}

function collectHelperModelReferences(): HelperModelReference[] {
  const references: HelperModelReference[] = []

  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.status === 'deprecated') {
        continue
      }

      if (model.imageGeneration) {
        references.push({
          providerId: provider.id,
          referencingModelId: model.id,
          referenceKind: 'controllerModel',
          helperModelId: model.imageGeneration.controllerModel,
        })
      }

      if (model.research) {
        references.push({
          providerId: provider.id,
          referencingModelId: model.id,
          referenceKind: 'assistModel',
          helperModelId: model.research.assistModel,
        })
      }
    }
  }

  return references
}

describe('helper models referenced by the curated catalog', () => {
  const references = collectHelperModelReferences()

  it('finds image-generation and deep-research references to guard', () => {
    const referenceKinds = new Set(
      references.map(reference => reference.referenceKind),
    )

    expect(referenceKinds).toEqual(
      new Set(['controllerModel', 'assistModel']),
    )
  })

  it('points every active model\'s controllerModel and assistModel at a '
    + 'model that exists and is not deprecated', () => {
    const violations: string[] = []

    for (const reference of references) {
      const provider = providers.find(({ id }) => {
        return id === reference.providerId
      })
      const helperModel = provider?.models.find(({ id }) => {
        return id === reference.helperModelId
      })
      const description = `${reference.providerId}/`
        + `${reference.referencingModelId} ${reference.referenceKind} `
        + `"${reference.helperModelId}"`

      if (!helperModel) {
        violations.push(`${description} is not curated by its provider`)

        continue
      }

      if (helperModel.status === 'deprecated') {
        violations.push(`${description} is deprecated`)
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps every project-memory model active', () => {
    const projectMemoryModels = providers.flatMap((provider) => {
      return provider.models.filter(model => model.forProjectMemory)
    })

    expect(projectMemoryModels.length).toBeGreaterThan(0)

    for (const model of projectMemoryModels) {
      expect(model.status).not.toBe('deprecated')
    }
  })
})
