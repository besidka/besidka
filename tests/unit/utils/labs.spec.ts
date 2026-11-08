import type { LabsFeature } from '#shared/types/features.d'
import { describe, expect, it } from 'vitest'
import {
  LABS_DEFAULT_ICON,
  describeMissingKeyKind,
  findMissingKeyKinds,
  getLabsFeatureIcon,
  getLabsSpendNote,
  getLabsStageLabel,
  getProviderIdsForKeyKind,
  groupLabsFeatures,
} from '../../../app/utils/labs'

function createFeature(overrides: Partial<LabsFeature>): LabsFeature {
  return {
    key: 'artifacts',
    title: 'Artifacts',
    description: 'Description',
    stage: 'internal',
    spend: 'none',
    optIn: 'none',
    requires: { keyKinds: [] },
    parent: null,
    optedIn: false,
    active: true,
    ...overrides,
  }
}

describe('labs utils', () => {
  it('nests children under their top-level ancestor in registry order', () => {
    const groups = groupLabsFeatures([
      createFeature({ key: 'artifacts' }),
      createFeature({ key: 'artifacts.react', parent: 'artifacts' }),
      createFeature({ key: 'research.custom' }),
      createFeature({
        key: 'research.custom.max',
        parent: 'research.custom',
      }),
    ])

    expect(groups.map((group) => {
      return [group.feature.key, group.children.map(child => child.key)]
    })).toEqual([
      ['artifacts', ['artifacts.react']],
      ['research.custom', ['research.custom.max']],
    ])
  })

  it('keeps a child whose parent is missing as a top-level feature', () => {
    const groups = groupLabsFeatures([
      createFeature({ key: 'artifacts.react', parent: 'artifacts' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.feature.key).toBe('artifacts.react')
  })

  it('labels stages and spend', () => {
    expect(getLabsStageLabel('internal')).toBe('Internal')
    expect(getLabsStageLabel('beta')).toBe('Beta')
    expect(getLabsSpendNote('none')).toBeNull()
    expect(getLabsSpendNote('foreground')).toBe('Uses your API keys')
    expect(getLabsSpendNote('background')).toContain('in the background')
  })

  it('falls back to the flask icon', () => {
    expect(getLabsFeatureIcon('artifacts')).toBe('lucide:app-window')
    expect(getLabsFeatureIcon('unknown')).toBe(LABS_DEFAULT_ICON)
  })

  it('counts gateway keys as model provider keys', () => {
    expect(getProviderIdsForKeyKind('provider')).toEqual(
      expect.arrayContaining(['anthropic', 'openrouter']),
    )
    expect(getProviderIdsForKeyKind('search')).toEqual(['brave', 'exa'])
  })

  it('describes missing key kinds', () => {
    expect(describeMissingKeyKind('search')).toBe('Needs a Brave or Exa key')
    expect(describeMissingKeyKind('provider'))
      .toBe('Needs an API key for a model provider or gateway')
  })

  it('reports a kind missing only when every provider of it is missing', () => {
    const feature = createFeature({
      requires: { keyKinds: ['provider', 'search'] },
    })

    expect(findMissingKeyKinds(feature, (providerId) => {
      return providerId === 'brave' ? 'saved' : 'missing'
    })).toEqual(['provider'])
    expect(findMissingKeyKinds(feature, () => 'unknown')).toEqual([])
    expect(findMissingKeyKinds(feature, () => 'missing'))
      .toEqual(['provider', 'search'])
  })
})
