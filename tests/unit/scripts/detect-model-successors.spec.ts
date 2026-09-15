import { describe, expect, it } from 'vitest'
import {
  DECLINED_IDS,
  compareModelVersions,
  findSuccessorProposals,
  formatSuccessorProposalsReport,
  insertCuratedEntry,
  isProposableTemplate,
  parseModelFamily,
  renderCuratedEntry,
} from '../../../scripts/detect-model-successors.mjs'

function buildUpstreamModel(overrides = {}) {
  return {
    name: 'Model Name',
    description: 'Model description',
    release_date: '2026-01-01',
    cost: { input: 0.5, output: 2 },
    tool_call: true,
    reasoning: true,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 1_000_000, output: 65_536 },
    ...overrides,
  }
}

describe('parseModelFamily', () => {
  it('splits a dotted version inside a suffixed id', () => {
    expect(parseModelFamily('gemini-3.7-flash')).toEqual({
      family: 'gemini-{v}-flash',
      version: '3.7',
    })
  })

  it('splits a dotted version before a bare suffix', () => {
    expect(parseModelFamily('gpt-5.4-nano')).toEqual({
      family: 'gpt-{v}-nano',
      version: '5.4',
    })
  })

  it('splits a single-digit version fused with a trailing letter', () => {
    expect(parseModelFamily('gpt-4o')).toEqual({
      family: 'gpt-{v}o',
      version: '4',
    })
  })

  it('splits a version with no separator at all', () => {
    expect(parseModelFamily('o3')).toEqual({
      family: 'o{v}',
      version: '3',
    })
  })

  it('treats a hyphenated version segment as one version', () => {
    expect(parseModelFamily('claude-opus-4-8')).toEqual({
      family: 'claude-opus-{v}',
      version: '4-8',
    })
  })

  it('returns null when the id has no digit at all', () => {
    expect(parseModelFamily('gemini-flash-latest')).toBeNull()
  })
})

describe('compareModelVersions', () => {
  it('treats a higher minor segment as newer', () => {
    expect(compareModelVersions('3.10', '3.9')).toBeGreaterThan(0)
  })

  it('treats a lower major segment as older', () => {
    expect(compareModelVersions('4-8', '5')).toBeLessThan(0)
  })

  it('returns 0 for identical version strings', () => {
    expect(compareModelVersions('5.1', '5.1')).toBe(0)
  })

  it('treats a version with fewer segments as older', () => {
    expect(compareModelVersions('5', '5.1')).toBeLessThan(0)
  })
})

describe('isProposableTemplate', () => {
  function buildTemplate(overrides = {}) {
    return {
      id: 'gemini-3.7-flash',
      price: { tokens: 1_000_000 },
      tools: ['web_search', 'image_generation'],
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      ...overrides,
    }
  }

  it('rejects a template with a status field', () => {
    const template = buildTemplate({ status: 'deprecated' })

    expect(isProposableTemplate(template)).toBe(false)
  })

  it('rejects a template priced by a display string', () => {
    const template = buildTemplate({
      price: { tokens: 1, display: '$0.041 / image, plus input' },
    })

    expect(isProposableTemplate(template)).toBe(false)
  })

  it('rejects a template not priced at the 1M token unit', () => {
    const template = buildTemplate({ price: { tokens: 1 } })

    expect(isProposableTemplate(template)).toBe(false)
  })

  it('rejects a template whose reasoning mode is not levels', () => {
    const template = buildTemplate({
      reasoning: { mode: 'effort', levels: ['low', 'high'] },
    })

    expect(isProposableTemplate(template)).toBe(false)
  })

  it('accepts a template with no reasoning block at all', () => {
    const template = buildTemplate({ reasoning: undefined })

    expect(isProposableTemplate(template)).toBe(true)
  })

  it('accepts a template with a levels reasoning block', () => {
    const template = buildTemplate()

    expect(isProposableTemplate(template)).toBe(true)
  })

  it('accepts a template carrying retiredAt and a curated name', () => {
    const template = buildTemplate({
      retiredAt: '2026-03-09',
      name: 'Custom Display Name',
    })

    expect(isProposableTemplate(template)).toBe(true)
  })
})

describe('findSuccessorProposals', () => {
  const gemini35Flash = {
    id: 'gemini-3.5-flash',
    price: { tokens: 1_000_000 },
    tools: ['web_search', 'image_generation'],
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
  }
  const gemini36Flash = {
    id: 'gemini-3.6-flash',
    price: { tokens: 1_000_000 },
    tools: ['web_search', 'image_generation'],
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
  }
  const gemini37Flash = {
    id: 'gemini-3.7-flash',
    price: { tokens: 1_000_000 },
    tools: ['web_search', 'image_generation'],
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
  }

  const primaryGoogleCatalog = {
    google: {
      models: {
        'gemini-3.5-flash': buildUpstreamModel({
          name: 'Gemini 3.5 Flash',
          release_date: '2025-10-01',
        }),
        'gemini-3.6-flash': buildUpstreamModel({
          name: 'Gemini 3.6 Flash',
          release_date: '2025-12-01',
        }),
        'gemini-3.7-flash': buildUpstreamModel({
          name: 'Gemini 3.7 Flash',
          release_date: '2026-01-01',
        }),
        'gemini-3.8-flash': buildUpstreamModel({
          name: 'Gemini 3.8 Flash',
          release_date: '2026-03-01',
        }),
        'gemini-flash-latest': buildUpstreamModel({
          name: 'Gemini Flash Latest',
        }),
        'gemini-omni-flash-preview': buildUpstreamModel({
          name: 'Gemini Omni Flash Preview',
          tool_call: false,
        }),
        'gemini-embedding-3.5': buildUpstreamModel({
          name: 'Gemini Embedding 3.5',
          tool_call: false,
        }),
        'gemini-3.9-flash': buildUpstreamModel({
          name: 'Gemini 3.9 Flash',
          release_date: '2026-04-01',
          status: 'deprecated',
        }),
      },
    },
  }

  it('proposes exactly the next point release for a matching family', () => {
    const provider = {
      id: 'google',
      models: [gemini35Flash, gemini36Flash, gemini37Flash],
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog: primaryGoogleCatalog,
    })

    expect(result).toEqual({
      proposals: [{
        providerId: 'google',
        templateId: 'gemini-3.7-flash',
        modelId: 'gemini-3.8-flash',
        template: gemini37Flash,
      }],
      priceTierFlags: [],
      declinedSkips: [],
      familiesNeedingHuman: [],
    })
  })

  it('proposes nothing once the successor is already curated', () => {
    const provider = {
      id: 'google',
      models: [
        gemini35Flash,
        gemini36Flash,
        gemini37Flash,
        {
          id: 'gemini-3.8-flash',
          price: { tokens: 1_000_000 },
          tools: ['web_search', 'image_generation'],
          reasoning: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
      ],
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog: primaryGoogleCatalog,
    })

    expect(result.proposals).toEqual([])
  })

  it('skips a declined id even when every other guardrail passes', () => {
    const provider = {
      id: 'openai',
      models: [
        {
          id: 'gpt-5.6-sol',
          price: { tokens: 1_000_000 },
          tools: ['web_search', 'image_generation'],
          reasoning: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
        {
          id: 'gpt-5.5',
          price: { tokens: 1_000_000 },
          tools: ['web_search', 'image_generation'],
          reasoning: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
      ],
    }
    const catalog = {
      openai: {
        models: {
          'gpt-5.6-sol': buildUpstreamModel({
            name: 'GPT-5.6 Sol',
            release_date: '2026-06-01',
            cost: { input: 1, output: 4 },
          }),
          'gpt-5.5': buildUpstreamModel({
            name: 'GPT-5.5',
            release_date: '2026-04-01',
            cost: { input: 1, output: 4 },
          }),
          'gpt-5.6': buildUpstreamModel({
            name: 'GPT-5.6',
            release_date: '2026-06-15',
            cost: { input: 1.2, output: 4.5 },
          }),
        },
      },
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog,
    })

    expect(result.proposals).toEqual([])
    expect(result.declinedSkips).toEqual([{
      providerId: 'openai',
      id: 'gpt-5.6',
      reason: 'previously declined (see DECLINED_IDS)',
    }])
  })

  it('excludes a duplicate-spec alias even when not in DECLINED_IDS', () => {
    const provider = {
      id: 'openai',
      models: [
        {
          id: 'gpt-5.6-sol',
          price: { tokens: 1_000_000 },
          tools: ['web_search', 'image_generation'],
          reasoning: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
        {
          id: 'gpt-5.5',
          price: { tokens: 1_000_000 },
          tools: ['web_search', 'image_generation'],
          reasoning: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
      ],
    }
    const catalog = {
      openai: {
        models: {
          'gpt-5.6-sol': buildUpstreamModel({
            name: 'GPT-5.6 Sol',
            release_date: '2026-06-01',
            cost: { input: 1, output: 4 },
          }),
          'gpt-5.5': buildUpstreamModel({
            name: 'GPT-5.5',
            release_date: '2026-04-01',
            cost: { input: 1, output: 4 },
          }),
          'gpt-5.7': buildUpstreamModel({
            name: 'GPT-5.7',
            release_date: '2026-06-01',
            cost: { input: 1, output: 4 },
          }),
        },
      },
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog,
    })

    expect(result.proposals).toEqual([])
    expect(result.declinedSkips).toEqual([{
      providerId: 'openai',
      id: 'gpt-5.7',
      reason: 'duplicate of a curated sibling: same cost and release '
        + 'date upstream',
    }])
  })

  it('flags a same-family candidate whose price exceeds the 2x band', () => {
    const provider = {
      id: 'openai',
      models: [{
        id: 'widget-1',
        price: { tokens: 1_000_000 },
        tools: ['web_search'],
      }],
    }
    const catalog = {
      openai: {
        models: {
          'widget-1': buildUpstreamModel({
            name: 'Widget 1',
            release_date: '2026-01-01',
            cost: { input: 1, output: 5 },
            reasoning: false,
          }),
          'widget-2': buildUpstreamModel({
            name: 'Widget 2',
            release_date: '2026-02-01',
            cost: { input: 3, output: 15 },
            reasoning: false,
          }),
        },
      },
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog,
    })

    expect(result.proposals).toEqual([])
    expect(result.priceTierFlags).toEqual([{
      providerId: 'openai',
      templateId: 'widget-1',
      id: 'widget-2',
      ratio: 3,
    }])
  })

  describe('isolated candidate guardrails', () => {
    function buildSingleFamilyFixture({
      templateOverrides = {},
      candidateOverrides = {},
    } = {}) {
      const template = {
        id: 'gemini-3.7-flash',
        price: { tokens: 1_000_000 },
        tools: ['web_search', 'image_generation'],
        reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
        ...templateOverrides,
      }
      const provider = {
        id: 'google',
        models: [template],
      }
      const catalog = {
        google: {
          models: {
            'gemini-3.7-flash': buildUpstreamModel({
              name: 'Gemini 3.7 Flash',
              release_date: '2026-01-01',
            }),
            'gemini-3.8-flash': buildUpstreamModel({
              name: 'Gemini 3.8 Flash',
              release_date: '2026-03-01',
              ...candidateOverrides,
            }),
          },
        },
      }

      return { provider, catalog }
    }

    it('excludes a candidate whose tool_call is false', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        candidateOverrides: { tool_call: false },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })

    it('excludes a candidate with reasoning when its template has none', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        templateOverrides: { reasoning: undefined },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })

    it('excludes a candidate with no reasoning when its template has some', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        candidateOverrides: { reasoning: false },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })

    it('excludes a candidate whose upstream status is set', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        candidateOverrides: { status: 'beta' },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })

    it('excludes a candidate whose output modality drops text', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        candidateOverrides: {
          modalities: { input: ['text'], output: ['audio'] },
        },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })

    it('excludes a candidate missing limit.output metadata', () => {
      const { provider, catalog } = buildSingleFamilyFixture({
        candidateOverrides: {
          limit: { context: 1_000_000 },
        },
      })

      const result = findSuccessorProposals({
        providers: [provider],
        catalog,
      })

      expect(result.proposals).toEqual([])
      expect(result.priceTierFlags).toEqual([])
    })
  })

  it('produces no proposal when the template needs human review', () => {
    const provider = {
      id: 'openai',
      models: [{
        id: 'gpt-9-legacy',
        status: 'deprecated',
        price: { tokens: 1_000_000 },
        tools: ['web_search'],
      }],
    }
    const catalog = {
      openai: {
        models: {
          'gpt-9-legacy': buildUpstreamModel({
            name: 'GPT-9 Legacy',
            release_date: '2025-01-01',
          }),
          'gpt-9.1-legacy': buildUpstreamModel({
            name: 'GPT-9.1 Legacy',
            release_date: '2025-06-01',
          }),
        },
      },
    }

    const result = findSuccessorProposals({
      providers: [provider],
      catalog,
    })

    expect(result.proposals).toEqual([])
    expect(result.familiesNeedingHuman).toEqual([{
      providerId: 'openai',
      family: 'gpt-{v}-legacy',
      templateId: 'gpt-9-legacy',
    }])
  })
})

describe('renderCuratedEntry', () => {
  it('renders tools and a reasoning block', () => {
    const template = {
      id: 'gemini-3.7-flash',
      price: { tokens: 1_000_000 },
      tools: ['web_search', 'image_generation'],
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }

    const rendered = renderCuratedEntry({
      id: 'gemini-3.8-flash',
      template,
    })

    expect(rendered).toBe([
      '    {',
      '      id: \'gemini-3.8-flash\',',
      '      price: {',
      '        tokens: 1_000_000,',
      '      },',
      '      tools: [\'web_search\', \'image_generation\'],',
      '      reasoning: {',
      '        mode: \'levels\',',
      '        levels: [\'low\', \'medium\', \'high\'],',
      '      },',
      '    },',
    ].join('\n'))
  })

  it('renders empty tools without a reasoning block', () => {
    const template = {
      id: 'gemini-3.1-flash-lite',
      price: { tokens: 500_000 },
      tools: [],
    }

    const rendered = renderCuratedEntry({
      id: 'gemini-3.2-flash-lite',
      template,
    })

    expect(rendered).toBe([
      '    {',
      '      id: \'gemini-3.2-flash-lite\',',
      '      price: {',
      '        tokens: 500_000,',
      '      },',
      '      tools: [],',
      '    },',
    ].join('\n'))
  })

  it('never carries over lifecycle or product override fields', () => {
    const template = {
      id: 'gemini-3.1-flash-lite',
      price: { tokens: 1_000_000 },
      tools: ['web_search'],
      reasoning: { mode: 'levels', levels: ['low', 'high'] },
      retiredAt: '2027-05-07',
      status: 'deprecated',
      name: 'Custom Name',
      default: true,
      forProjectMemory: true,
    }

    const rendered = renderCuratedEntry({
      id: 'gemini-3.2-flash-lite',
      template,
    })

    expect(rendered).not.toContain('retiredAt')
    expect(rendered).not.toContain('status:')
    expect(rendered).not.toContain('name:')
    expect(rendered).not.toContain('default')
    expect(rendered).not.toContain('forProjectMemory')
  })
})

describe('insertCuratedEntry', () => {
  const fixtureSource = `export default {
  id: 'demo',
  models: [
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-5-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-image-2',
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
    },
  ],
} satisfies CuratedProvider`

  const entryText = `    {
      id: 'gpt-5.1',
    },`

  it('inserts before the target sibling when it is the first model', () => {
    const expected = `export default {
  id: 'demo',
  models: [
    {
      id: 'gpt-5.1',
    },
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-5-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-image-2',
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
    },
  ],
} satisfies CuratedProvider`

    expect(insertCuratedEntry(fixtureSource, 'gpt-5', entryText))
      .toBe(expected)
  })

  it('throws when the template id does not exist', () => {
    expect(() => {
      insertCuratedEntry(fixtureSource, 'gpt-9-missing', entryText)
    }).toThrow('No curated model with id "gpt-9-missing" found.')
  })

  it('throws when the template id appears more than once', () => {
    const duplicateIdSource = `export default {
  id: 'demo',
  models: [
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
  ],
} satisfies CuratedProvider`

    expect(() => {
      insertCuratedEntry(duplicateIdSource, 'gpt-5', entryText)
    }).toThrow('Ambiguous match: found 2 curated models with id "gpt-5".')
  })

  it('matches the exact id and not a longer id sharing the prefix', () => {
    const result = insertCuratedEntry(fixtureSource, 'gpt-5', entryText)

    const gpt5Index = result.indexOf('id: \'gpt-5\',')
    const insertedIndex = result.indexOf(entryText)
    const gpt5MiniIndex = result.indexOf('id: \'gpt-5-mini\',')

    expect(insertedIndex).toBeGreaterThanOrEqual(0)
    expect(insertedIndex).toBeLessThan(gpt5Index)
    expect(insertedIndex).toBeLessThan(gpt5MiniIndex)
  })

  it('inserts before the last model without disturbing its tail position', () => {
    const expected = `export default {
  id: 'demo',
  models: [
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-5-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
    },
    {
      id: 'gpt-5.1',
    },
    {
      id: 'gpt-image-2',
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
    },
  ],
} satisfies CuratedProvider`

    const result = insertCuratedEntry(fixtureSource, 'gpt-image-2', entryText)

    expect(result).toBe(expected)
    expect(result.trimEnd().endsWith(
      `    {
      id: 'gpt-image-2',
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
    },
  ],
} satisfies CuratedProvider`,
    )).toBe(true)
  })
})

describe('formatSuccessorProposalsReport', () => {
  it('reports no successors for an all-empty result', () => {
    const report = formatSuccessorProposalsReport({
      proposals: [],
      priceTierFlags: [],
      declinedSkips: [],
      familiesNeedingHuman: [],
    })

    expect(report.length).toBeGreaterThan(0)
    expect(report.toLowerCase()).toContain('no same-family successors found')
  })

  it('includes both the proposed id and its template id', () => {
    const report = formatSuccessorProposalsReport({
      proposals: [{
        providerId: 'google',
        templateId: 'gemini-3.7-flash',
        modelId: 'gemini-3.8-flash',
        template: {},
      }],
      priceTierFlags: [],
      declinedSkips: [],
      familiesNeedingHuman: [],
    })

    expect(report).toContain('gemini-3.8-flash')
    expect(report).toContain('gemini-3.7-flash')
  })

  it('includes the price ratio for a flagged candidate', () => {
    const report = formatSuccessorProposalsReport({
      proposals: [],
      priceTierFlags: [{
        providerId: 'openai',
        templateId: 'widget-1',
        id: 'widget-2',
        ratio: 3,
      }],
      declinedSkips: [],
      familiesNeedingHuman: [],
    })

    expect(report.toLowerCase()).toContain('price')
    expect(report).toContain('3.0x')
  })
})

describe('DECLINED_IDS', () => {
  it('still declines gpt-5.6', () => {
    expect(DECLINED_IDS).toContain('gpt-5.6')
  })
})
