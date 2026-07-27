/**
 * Landing-page structured data as one `@graph` so nodes cross-reference by
 * `@id`. `alternateName` carries the Cyrillic and "AI"-suffixed spellings,
 * because "Besidka" collides with unrelated entrenched entities in search.
 * Keep it in sync with the `#about-the-name` landing section — that is the
 * on-page half of the same claim, and the only place either half states it in a
 * sentence. See docs/seo.md.
 */

const ALTERNATE_NAMES = [
  'Besidka AI',
  'Бесідка',
  'Бесідка AI',
]

const CODE_REPOSITORY = 'https://github.com/besidka/besidka'
const X_PROFILE = 'https://x.com/besidka_ai'
const LICENSE_URL = 'https://opensource.org/licenses/MIT'

export type FaqItem = {
  question: string
  answer: string
}

export type LandingLdInput = {
  baseUrl: string
  siteName: string
  description: string
  faqs?: FaqItem[]
}

export type LandingLdIds = {
  siteUrl: string
  organizationId: string
  websiteId: string
  applicationId: string
}

// `new URL` normalises to a trailing slash so every schema URL is
// byte-identical to the canonical app.vue emits.
export function buildLandingLdIds(baseUrl: string): LandingLdIds {
  const siteUrl = new URL('/', baseUrl).href

  return {
    siteUrl,
    organizationId: `${siteUrl}#organization`,
    websiteId: `${siteUrl}#website`,
    applicationId: `${siteUrl}#software`,
  }
}

export function buildOrganizationLd(
  input: LandingLdInput,
  ids: LandingLdIds = buildLandingLdIds(input.baseUrl),
) {
  return {
    '@type': 'Organization',
    '@id': ids.organizationId,
    'name': input.siteName,
    'alternateName': ALTERNATE_NAMES,
    'url': ids.siteUrl,
    'description': input.description,
    'logo': `${ids.siteUrl}web-app-manifest-512x512.png`,
    'sameAs': [
      CODE_REPOSITORY,
      X_PROFILE,
    ],
  }
}

export function buildWebSiteLd(
  input: LandingLdInput,
  ids: LandingLdIds = buildLandingLdIds(input.baseUrl),
) {
  return {
    '@type': 'WebSite',
    '@id': ids.websiteId,
    'name': input.siteName,
    'alternateName': ALTERNATE_NAMES,
    'url': ids.siteUrl,
    'description': input.description,
    'inLanguage': 'en',
    'publisher': { '@id': ids.organizationId },
  }
}

export function buildSoftwareApplicationLd(
  input: LandingLdInput,
  ids: LandingLdIds = buildLandingLdIds(input.baseUrl),
) {
  return {
    '@type': 'SoftwareApplication',
    '@id': ids.applicationId,
    'name': input.siteName,
    'alternateName': ALTERNATE_NAMES,
    'description': input.description,
    'url': ids.siteUrl,
    'applicationCategory': 'CommunicationApplication',
    'operatingSystem': 'Web',
    'isAccessibleForFree': true,
    'license': LICENSE_URL,
    'offers': {
      '@type': 'Offer',
      'price': '0',
      'priceCurrency': 'USD',
    },
    'screenshot': `${ids.siteUrl}og-image.png`,
    'codeRepository': CODE_REPOSITORY,
    'publisher': { '@id': ids.organizationId },
    'isPartOf': { '@id': ids.websiteId },
  }
}

export function buildFaqPageLd(
  faqs: FaqItem[],
  ids?: LandingLdIds,
) {
  const questions = faqs.map((faq) => {
    return {
      '@type': 'Question',
      'name': faq.question,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': faq.answer,
      },
    }
  })

  if (!ids) {
    return {
      '@type': 'FAQPage',
      'mainEntity': questions,
    }
  }

  return {
    '@type': 'FAQPage',
    '@id': `${ids.siteUrl}#faq`,
    'isPartOf': { '@id': ids.websiteId },
    'mainEntity': questions,
  }
}

export function buildLandingGraphLd(input: LandingLdInput) {
  const ids = buildLandingLdIds(input.baseUrl)
  const faqs = input.faqs ?? []

  const graph: Array<Record<string, unknown>> = [
    buildOrganizationLd(input, ids),
    buildWebSiteLd(input, ids),
    buildSoftwareApplicationLd(input, ids),
  ]

  if (faqs.length) {
    graph.push(buildFaqPageLd(faqs, ids))
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}
