import { describe, expect, it } from 'vitest'
import { providerMeta } from '#shared/utils/provider-meta'
import {
  findGuideEntry,
  formatKeyGuide,
  listProviders,
  toGuideSlug,
} from '~~/server/utils/mcp/key-guides'
import type {
  KeyGuideIndexEntry,
  KeyGuideRecord,
} from '~~/server/utils/mcp/key-guides'

const ORIGIN = 'https://besidka.com'

const guides: KeyGuideIndexEntry[] = [
  {
    path: '/guides/claude-api-key',
    provider: 'anthropic',
    title: 'How to get an Anthropic API key',
  },
  {
    path: '/guides/openai-api-key',
    provider: 'openai',
    title: 'How to get an OpenAI API key',
  },
]

describe('toGuideSlug', () => {
  it('strips the guides prefix from a content path', () => {
    expect(toGuideSlug('/guides/openai-api-key')).toBe('openai-api-key')
  })
})

describe('listProviders', () => {
  it('lists every provider meta entry', () => {
    const list = listProviders(providerMeta, guides, ORIGIN)

    expect(list).toHaveLength(Object.keys(providerMeta).length)
  })

  it('links the key guide on the site origin when one exists', () => {
    const list = listProviders(providerMeta, guides, ORIGIN)
    const openai = list.find((entry) => {
      return entry.id === 'openai'
    })

    expect(openai?.keyGuide).toEqual({
      slug: 'openai-api-key',
      url: 'https://besidka.com/guides/openai-api-key',
    })
  })

  it('sets keyGuide to null when the provider has no guide', () => {
    const list = listProviders(providerMeta, guides, ORIGIN)
    const xai = list.find((entry) => {
      return entry.id === 'xai'
    })

    expect(xai?.keyGuide).toBeNull()
  })

  it('exposes key field names but never secrets or placeholders', () => {
    const list = listProviders(providerMeta, guides, ORIGIN)
    const cloudflare = list.find((entry) => {
      return entry.id === 'cloudflare'
    })

    expect(cloudflare?.keyFields).toEqual([
      'accountId',
      'gatewayId',
      'apiKey',
    ])
    expect(JSON.stringify(list)).not.toContain('keyPlaceholder')
  })
})

describe('findGuideEntry', () => {
  it('matches a provider id', () => {
    expect(findGuideEntry(guides, 'anthropic')?.path)
      .toBe('/guides/claude-api-key')
  })

  it('matches a guide slug', () => {
    expect(findGuideEntry(guides, 'openai-api-key')?.provider)
      .toBe('openai')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(findGuideEntry(guides, '  OpenAI ')?.provider).toBe('openai')
  })

  it('returns null for an unknown identifier', () => {
    expect(findGuideEntry(guides, 'unknown')).toBeNull()
  })

  it('does not match a path traversal attempt', () => {
    expect(findGuideEntry(guides, '../legal/privacy-policy')).toBeNull()
  })
})

describe('formatKeyGuide', () => {
  const record: KeyGuideRecord = {
    path: '/guides/openai-api-key',
    provider: 'openai',
    title: 'How to get an OpenAI API key',
    description: 'Create an OpenAI API key.',
    summary: undefined,
    updatedAt: '2026-10-26',
    checkedAt: '2026-10-20',
    keyUrl: 'https://platform.openai.com/api-keys',
    requirements: { card: true, sources: [] },
    faq: undefined,
    body: {
      type: 'minimark',
      value: [
        ['ol', {}, ['li', {}, 'Open the ', ['strong', {}, 'keys'], ' page.']],
      ],
    },
  }

  it('returns structured facts, the guide URL and the steps as markdown', () => {
    const formatted = formatKeyGuide(record, ORIGIN)

    expect(formatted).toMatchObject({
      slug: 'openai-api-key',
      provider: 'openai',
      url: 'https://besidka.com/guides/openai-api-key',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      stepsMarkdown: '1. Open the **keys** page.',
    })
  })

  it('omits nullable optional fields instead of returning null', () => {
    const formatted = formatKeyGuide({
      ...record,
      summary: null,
      faq: null,
    } as unknown as KeyGuideRecord, ORIGIN)

    expect(JSON.stringify(formatted)).not.toContain('null')
  })
})
