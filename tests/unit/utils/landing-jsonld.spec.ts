import { describe, expect, it } from 'vitest'
import {
  buildFaqPageLd,
  buildLandingGraphLd,
  buildLandingLdIds,
  buildOrganizationLd,
  buildSoftwareApplicationLd,
  buildWebSiteLd,
} from '../../../app/utils/landing-jsonld'

const BASE_URL = 'https://besidka.com'

const INPUT = {
  baseUrl: BASE_URL,
  siteName: 'Besidka',
  description: 'An open-source AI chat application.',
}

const FAQS = [
  { question: 'What does Besidka mean?', answer: 'It means gazebo.' },
  { question: 'Is it open source?', answer: 'Yes, fully.' },
]

function collectGraphIdReferences(node: Record<string, unknown>) {
  const references: string[] = []

  for (const key of ['publisher', 'isPartOf']) {
    const value = node[key]

    if (value && typeof value === 'object' && '@id' in value) {
      references.push((value as { '@id': string })['@id'])
    }
  }

  return references
}

describe('buildLandingLdIds', () => {
  it('normalises a base URL without a trailing slash to siteUrl with one', () => {
    const ids = buildLandingLdIds('https://besidka.com')

    expect(ids.siteUrl).toBe('https://besidka.com/')
  })

  it('is idempotent when the base URL already has a trailing slash', () => {
    const ids = buildLandingLdIds('https://besidka.com/')

    expect(ids.siteUrl).toBe('https://besidka.com/')
  })

  it('derives @id values from the normalised siteUrl', () => {
    const ids = buildLandingLdIds(BASE_URL)

    expect(ids.organizationId).toBe('https://besidka.com/#organization')
    expect(ids.websiteId).toBe('https://besidka.com/#website')
    expect(ids.applicationId).toBe('https://besidka.com/#software')
  })
})

describe('buildOrganizationLd', () => {
  it('includes alternateName with the Cyrillic brand spelling', () => {
    const organization = buildOrganizationLd(INPUT)

    expect(organization.alternateName).toContain('Бесідка')
    expect(organization.alternateName).toContain('Besidka AI')
    expect(organization.alternateName).toContain('Бесідка AI')
  })

  it('joins the logo URL onto siteUrl without a double slash', () => {
    const organization = buildOrganizationLd(INPUT)
    const [, pathAfterScheme] = organization.logo.split('://')

    expect(pathAfterScheme).not.toContain('//')
  })
})

describe('buildWebSiteLd', () => {
  it('includes alternateName with the Cyrillic brand spelling', () => {
    const website = buildWebSiteLd(INPUT)

    expect(website.alternateName).toContain('Бесідка')
    expect(website.alternateName).toContain('Besidka AI')
    expect(website.alternateName).toContain('Бесідка AI')
  })
})

describe('buildSoftwareApplicationLd', () => {
  it('includes alternateName with the Cyrillic brand spelling', () => {
    const application = buildSoftwareApplicationLd(INPUT)

    expect(application.alternateName).toContain('Бесідка')
    expect(application.alternateName).toContain('Besidka AI')
    expect(application.alternateName).toContain('Бесідка AI')
  })

  it('joins the screenshot URL onto siteUrl without a double slash', () => {
    const application = buildSoftwareApplicationLd(INPUT)
    const [, pathAfterScheme] = application.screenshot.split('://')

    expect(pathAfterScheme).not.toContain('//')
  })
})

describe('buildFaqPageLd', () => {
  it('maps each faq to a Question with a nested Answer', () => {
    const faqPage = buildFaqPageLd(FAQS)

    expect(faqPage.mainEntity).toEqual([
      {
        '@type': 'Question',
        'name': 'What does Besidka mean?',
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': 'It means gazebo.',
        },
      },
      {
        '@type': 'Question',
        'name': 'Is it open source?',
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': 'Yes, fully.',
        },
      },
    ])
  })

  it('omits @id and isPartOf when called without ids', () => {
    const faqPage = buildFaqPageLd(FAQS)

    expect(faqPage).not.toHaveProperty('@id')
    expect(faqPage).not.toHaveProperty('isPartOf')
  })

  it('includes @id and isPartOf when called with ids', () => {
    const ids = buildLandingLdIds(BASE_URL)
    const faqPage = buildFaqPageLd(FAQS, ids)

    expect(faqPage['@id']).toBe(`${ids.siteUrl}#faq`)
    expect(faqPage.isPartOf).toEqual({ '@id': ids.websiteId })
  })
})

describe('buildLandingGraphLd', () => {
  it('emits exactly one @context at the top level and none per node', () => {
    const graphLd = buildLandingGraphLd({ ...INPUT, faqs: FAQS })

    expect(graphLd['@context']).toBe('https://schema.org')
    graphLd['@graph'].forEach((node) => {
      expect(node).not.toHaveProperty('@context')
    })
  })

  it('omits the FAQPage node when faqs is an empty array', () => {
    const graphLd = buildLandingGraphLd({ ...INPUT, faqs: [] })
    const types = graphLd['@graph'].map((node) => {
      return node['@type']
    })

    expect(types).not.toContain('FAQPage')
  })

  it('omits the FAQPage node when faqs is undefined', () => {
    const graphLd = buildLandingGraphLd(INPUT)
    const types = graphLd['@graph'].map((node) => {
      return node['@type']
    })

    expect(types).not.toContain('FAQPage')
  })

  it('includes the FAQPage node with one mainEntity question per faq', () => {
    const graphLd = buildLandingGraphLd({ ...INPUT, faqs: FAQS })
    const faqPage = graphLd['@graph'].find((node) => {
      return node['@type'] === 'FAQPage'
    })

    expect(faqPage).toBeDefined()
    expect((faqPage?.mainEntity as unknown[]).length).toBe(FAQS.length)
  })

  it('resolves every publisher/isPartOf @id reference to a node present '
    + 'in the graph', () => {
    const graphLd = buildLandingGraphLd({ ...INPUT, faqs: FAQS })
    const graph = graphLd['@graph']

    const presentIds = new Set(graph.map((node) => {
      return node['@id']
    }))

    const referencedIds = graph.flatMap((node) => {
      return collectGraphIdReferences(node)
    })

    expect(referencedIds.length).toBeGreaterThan(0)
    referencedIds.forEach((referencedId) => {
      expect(presentIds).toContain(referencedId)
    })
  })
})
