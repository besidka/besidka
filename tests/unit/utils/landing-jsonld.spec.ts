import { describe, expect, it } from 'vitest'
import {
  buildFaqPageLd,
  buildGuidePageLd,
  buildKeyGuidePageLd,
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
  entityDescription: 'An open-source AI chat application.',
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

  it('links the source repository through sameAs, not codeRepository', () => {
    const application = buildSoftwareApplicationLd(INPUT)

    expect(application.sameAs).toEqual(['https://github.com/besidka/besidka'])
    expect(application).not.toHaveProperty('codeRepository')
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
  it('uses entityDescription for the Organization, WebSite and '
    + 'SoftwareApplication descriptions, so a page meta description written '
    + 'as a call to action never becomes the entity description', () => {
    const entityDescription = 'Besidka is an open-source AI chat app.'
    const graphLd = buildLandingGraphLd({
      ...INPUT,
      entityDescription,
    })
    const entityDescriptions = graphLd['@graph']
      .filter((node) => {
        return ['Organization', 'WebSite', 'SoftwareApplication']
          .includes(node['@type'] as string)
      })
      .map((node) => {
        return node.description
      })

    expect(entityDescriptions).toEqual([
      entityDescription,
      entityDescription,
      entityDescription,
    ])
  })

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

describe('buildGuidePageLd', () => {
  const GUIDE_INPUT = {
    baseUrl: BASE_URL,
    url: 'https://besidka.com/byok',
    headline: 'Bring your own API key',
    description: 'How BYOK works in Besidka.',
    dateModified: '2026-10-11',
  }

  it('emits a TechArticle anchored on the page URL', () => {
    const articleLd = buildGuidePageLd(GUIDE_INPUT)

    expect(articleLd['@context']).toBe('https://schema.org')
    expect(articleLd['@type']).toBe('TechArticle')
    expect(articleLd['@id']).toBe('https://besidka.com/byok#article')
    expect(articleLd.url).toBe('https://besidka.com/byok')
    expect(articleLd.dateModified).toBe('2026-10-11')
  })

  it('references the same website, organization and software @ids the '
    + 'home page graph declares, so no second Organization is emitted', () => {
    const articleLd = buildGuidePageLd(GUIDE_INPUT)
    const graphLd = buildLandingGraphLd(INPUT)

    const homeIds = new Set(graphLd['@graph'].map((node) => {
      return node['@id']
    }))

    expect(homeIds).toContain(articleLd.isPartOf['@id'])
    expect(homeIds).toContain(articleLd.publisher['@id'])
    expect(homeIds).toContain(articleLd.about['@id'])
  })

  it('credits the organization as author of the article', () => {
    const articleLd = buildGuidePageLd(GUIDE_INPUT)
    const graphLd = buildLandingGraphLd(INPUT)
    const organization = graphLd['@graph'].find((node) => {
      return node['@type'] === 'Organization'
    })

    expect(articleLd.author).toEqual({ '@id': organization!['@id'] })
  })

  it('omits dateModified when no date is given', () => {
    const articleLd = buildGuidePageLd({
      ...GUIDE_INPUT,
      dateModified: undefined,
    })

    expect(articleLd).not.toHaveProperty('dateModified')
  })
})

describe('buildKeyGuidePageLd', () => {
  const KEY_GUIDE_INPUT = {
    baseUrl: BASE_URL,
    url: 'https://besidka.com/guides/gemini-api-key',
    headline: 'How to get a Gemini API key',
    description: 'Create a free Gemini API key in Google AI Studio.',
    dateModified: '2026-10-20',
  }

  const VIDEO = {
    src: '/videos/gemini-api-key.mp4',
    poster: '/videos/gemini-api-key.webp',
    duration: 'PT1M12S',
    uploadDate: '2026-10-20',
  }

  it('emits a single-node graph with only the article when there is no '
    + 'video, and never placeholder video values', () => {
    const keyGuideLd = buildKeyGuidePageLd(KEY_GUIDE_INPUT)

    expect(keyGuideLd['@context']).toBe('https://schema.org')
    expect(keyGuideLd['@graph']).toHaveLength(1)

    const [article] = keyGuideLd['@graph']

    expect(article!['@type']).toBe('TechArticle')
    expect(article!['@id'])
      .toBe('https://besidka.com/guides/gemini-api-key#article')
    expect(article).not.toHaveProperty('video')
    expect(JSON.stringify(keyGuideLd)).not.toContain('VideoObject')
  })

  it('shares the article node of buildGuidePageLd, minus its own context',
    () => {
      const keyGuideLd = buildKeyGuidePageLd(KEY_GUIDE_INPUT)
      const { '@context': _context, ...expectedArticle }
        = buildGuidePageLd(KEY_GUIDE_INPUT)

      expect(keyGuideLd['@graph'][0]).toEqual(expectedArticle)
    })

  it('references the same website, organization and software @ids the '
    + 'home page graph declares', () => {
    const [article] = buildKeyGuidePageLd(KEY_GUIDE_INPUT)['@graph']
    const homeIds = new Set(buildLandingGraphLd(INPUT)['@graph'].map((node) => {
      return node['@id']
    }))

    expect(homeIds).toContain((article!.isPartOf as { '@id': string })['@id'])
    expect(homeIds).toContain((article!.publisher as { '@id': string })['@id'])
    expect(homeIds).toContain((article!.about as { '@id': string })['@id'])
  })

  it('adds a VideoObject and links it from the article when a complete '
    + 'video is given', () => {
    const keyGuideLd = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: VIDEO,
    })
    const [article, video] = keyGuideLd['@graph']

    expect(keyGuideLd['@graph']).toHaveLength(2)
    expect(article!.video).toEqual({
      '@id': 'https://besidka.com/guides/gemini-api-key#video',
    })
    expect(video).toEqual({
      '@type': 'VideoObject',
      '@id': 'https://besidka.com/guides/gemini-api-key#video',
      'name': 'How to get a Gemini API key (video)',
      'description': 'Create a free Gemini API key in Google AI Studio.',
      'thumbnailUrl': 'https://besidka.com/videos/gemini-api-key.webp',
      'uploadDate': '2026-10-20',
      'duration': 'PT1M12S',
      'contentUrl': 'https://besidka.com/videos/gemini-api-key.mp4',
      'inLanguage': 'en',
    })
  })

  it('names the VideoObject after the video caption when one is set', () => {
    const [, video] = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: { ...VIDEO, caption: 'Watch the key being created' },
    })['@graph']

    expect(video!.name).toBe('Watch the key being created')
  })

  it('omits the VideoObject instead of throwing on an invalid video URL', () => {
    const invalidBaseLd = () => buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: { ...VIDEO, src: 'http://[invalid' },
    })

    expect(invalidBaseLd).not.toThrow()

    const keyGuideLd = invalidBaseLd()

    expect(keyGuideLd['@graph']).toHaveLength(1)
    expect(keyGuideLd['@graph'][0]).not.toHaveProperty('video')
  })

  it('omits the VideoObject for a non-web video URL scheme', () => {
    const keyGuideLd = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: { ...VIDEO, src: 'javascript:alert(1)' },
    })

    expect(keyGuideLd['@graph']).toHaveLength(1)
    expect(JSON.stringify(keyGuideLd)).not.toContain('javascript:')
  })

  it('keeps already-absolute video URLs as they are', () => {
    const [, video] = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: {
        ...VIDEO,
        src: 'https://cdn.besidka.com/key.mp4',
        poster: 'https://cdn.besidka.com/key.webp',
      },
    })['@graph']

    expect(video!.contentUrl).toBe('https://cdn.besidka.com/key.mp4')
    expect(video!.thumbnailUrl).toBe('https://cdn.besidka.com/key.webp')
  })

  it.each([
    ['src'],
    ['poster'],
    ['duration'],
    ['uploadDate'],
  ])('omits the VideoObject when the video has no %s', (missingKey) => {
    const keyGuideLd = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: { ...VIDEO, [missingKey]: undefined },
    })

    expect(keyGuideLd['@graph']).toHaveLength(1)
    expect(keyGuideLd['@graph'][0]).not.toHaveProperty('video')
  })

  it('omits the VideoObject for a null video', () => {
    const keyGuideLd = buildKeyGuidePageLd({
      ...KEY_GUIDE_INPUT,
      video: null,
    })

    expect(keyGuideLd['@graph']).toHaveLength(1)
  })
})
