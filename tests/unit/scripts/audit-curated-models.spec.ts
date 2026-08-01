import { describe, expect, it } from 'vitest'
import {
  findDeprecatedCuratedModels,
  findUncuratedModels,
  formatDeprecatedCuratedModelsWarning,
  formatUncuratedModelsReport,
} from '../../../scripts/audit-curated-models.mjs'

describe('findUncuratedModels', () => {
  it('excludes curated ids and keeps the rest', () => {
    const remoteModels = {
      'gpt-5.6': { name: 'GPT-5.6', release_date: '2026-07-09' },
      'gpt-5.6-sol': { name: 'GPT-5.6 Sol', release_date: '2026-07-09' },
      'gpt-4o': { name: 'GPT-4o', release_date: '2024-05-13' },
    }
    const curatedIds = new Set(['gpt-5.6'])

    const uncurated = findUncuratedModels(remoteModels, curatedIds)

    expect(uncurated.map(model => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-4o',
    ])
  })

  it('sorts newest release date first', () => {
    const remoteModels = {
      old: { name: 'Old', release_date: '2023-01-01' },
      new: { name: 'New', release_date: '2026-01-01' },
      mid: { name: 'Mid', release_date: '2025-01-01' },
    }

    const uncurated = findUncuratedModels(remoteModels, new Set())

    expect(uncurated.map(model => model.id)).toEqual(['new', 'mid', 'old'])
  })

  it('sorts entries without a release date last', () => {
    const remoteModels = {
      dated: { name: 'Dated', release_date: '2025-01-01' },
      undated: { name: 'Undated' },
    }

    const uncurated = findUncuratedModels(remoteModels, new Set())

    expect(uncurated.map(model => model.id)).toEqual(['dated', 'undated'])
  })

  it('returns an empty list when everything is curated', () => {
    const remoteModels = {
      'gpt-5.6': { name: 'GPT-5.6', release_date: '2026-07-09' },
    }
    const curatedIds = new Set(['gpt-5.6'])

    const uncurated = findUncuratedModels(remoteModels, curatedIds)

    expect(uncurated).toEqual([])
  })
})

describe('formatUncuratedModelsReport', () => {
  it('groups the report by provider with counts and release dates', () => {
    const report = formatUncuratedModelsReport([
      {
        providerId: 'openai',
        models: [
          { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', releaseDate: '2026-07-09' },
        ],
      },
      {
        providerId: 'google',
        models: [],
      },
    ])

    expect(report).toContain('openai (1 not curated):')
    expect(report).toContain(
      '    - gpt-5.6-sol (GPT-5.6 Sol, released 2026-07-09)',
    )
    expect(report).toContain('google (0 not curated):')
  })
})

describe('findDeprecatedCuratedModels', () => {
  it('flags a curated id whose upstream status is deprecated', () => {
    const remoteModels = {
      'gemini-3.1-flash-lite-preview': {
        name: 'Gemini 3.1 Flash Lite Preview',
        status: 'deprecated',
      },
      'gemini-3.1-pro-preview': {
        name: 'Gemini 3.1 Pro Preview',
      },
    }
    const curatedIds = new Set([
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-pro-preview',
    ])

    const deprecated = findDeprecatedCuratedModels(remoteModels, curatedIds)

    expect(deprecated).toEqual([
      {
        id: 'gemini-3.1-flash-lite-preview',
        name: 'Gemini 3.1 Flash Lite Preview',
      },
    ])
  })

  it('ignores a deprecated model that is not curated', () => {
    const remoteModels = {
      'gpt-4': { name: 'GPT-4', status: 'deprecated' },
    }

    const deprecated = findDeprecatedCuratedModels(remoteModels, new Set())

    expect(deprecated).toEqual([])
  })

  it('ignores non-deprecated statuses', () => {
    const remoteModels = {
      'veo-3.1-generate-preview': { name: 'Veo 3.1', status: 'beta' },
    }
    const curatedIds = new Set(['veo-3.1-generate-preview'])

    const deprecated = findDeprecatedCuratedModels(remoteModels, curatedIds)

    expect(deprecated).toEqual([])
  })
})

describe('formatDeprecatedCuratedModelsWarning', () => {
  it('returns null when nothing is deprecated', () => {
    const warning = formatDeprecatedCuratedModelsWarning([
      { providerId: 'openai', models: [] },
      { providerId: 'google', models: [] },
    ])

    expect(warning).toBeNull()
  })

  it('formats a distinct warning grouped by provider/id', () => {
    const warning = formatDeprecatedCuratedModelsWarning([
      {
        providerId: 'google',
        models: [{
          id: 'gemini-3.1-flash-lite-preview',
          name: 'Gemini 3.1 Flash Lite Preview',
        }],
      },
    ])

    expect(warning).toContain('⚠ DEPRECATED')
    expect(warning).toContain(
      '  - google/gemini-3.1-flash-lite-preview '
      + '(Gemini 3.1 Flash Lite Preview)',
    )
  })
})
