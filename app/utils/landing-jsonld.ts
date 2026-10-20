/**
 * Landing-page structured data as one `@graph` so nodes cross-reference by
 * `@id`. `alternateName` carries the Cyrillic and "AI"-suffixed spellings,
 * because "Besidka" collides with unrelated entrenched entities in search.
 * Keep it in sync with the `#about-the-name` landing section — that is the
 * on-page half of the same claim, and the only place either half states it in a
 * sentence. See docs/seo.md.
 */

import type { VideoMarker } from '#shared/types/video.d'
import { parseIsoDurationToSeconds, toMarkerPoints } from '#shared/utils/video'

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
  entityDescription: string
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
    'description': input.entityDescription,
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
    'description': input.entityDescription,
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
    'description': input.entityDescription,
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
    'sameAs': [CODE_REPOSITORY],
    'publisher': { '@id': ids.organizationId },
    'isPartOf': { '@id': ids.websiteId },
  }
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
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
        'text': stripMarkdownLinks(faq.answer),
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

export type GuidePageLdInput = {
  baseUrl: string
  url: string
  headline: string
  description: string
  dateModified?: string
}

// A standalone guide page reuses the home page's node ids, so its
// `isPartOf`/`publisher`/`about` resolve to the same site-wide entities
// instead of declaring a second Organization.
export function buildGuidePageLd(input: GuidePageLdInput) {
  const ids = buildLandingLdIds(input.baseUrl)

  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${input.url}#article`,
    'headline': input.headline,
    'description': input.description,
    'url': input.url,
    'inLanguage': 'en',
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    'isPartOf': { '@id': ids.websiteId },
    'author': { '@id': ids.organizationId },
    'publisher': { '@id': ids.organizationId },
    'about': { '@id': ids.applicationId },
  }
}

export type KeyGuideVideoLdInput = {
  src?: string
  poster?: string
  duration?: string
  uploadDate?: string
  caption?: string
  markers?: VideoMarker[]
}

export type KeyGuidePageLdInput = GuidePageLdInput & {
  video?: KeyGuideVideoLdInput | null
}

type CompleteKeyGuideVideo = Required<
  Omit<KeyGuideVideoLdInput, 'caption' | 'markers'>
> & Pick<KeyGuideVideoLdInput, 'caption' | 'markers'>

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

function isCompleteVideo(
  video: KeyGuideVideoLdInput | null | undefined,
): video is CompleteKeyGuideVideo {
  return !!video?.src
    && !!video.poster
    && !!video.duration
    && !!video.uploadDate
}

function resolveWebUrl(value: string, baseUrl: string): string | null {
  try {
    const resolvedUrl = new URL(value, baseUrl)

    return WEB_PROTOCOLS.has(resolvedUrl.protocol) ? resolvedUrl.href : null
  } catch {
    return null
  }
}

function buildClipsLd(
  video: CompleteKeyGuideVideo,
): Array<Record<string, unknown>> {
  const points = toMarkerPoints(video.markers)
  const totalSeconds = parseIsoDurationToSeconds(video.duration)

  return points.map((point, index) => {
    const endOffset = points[index + 1]?.time ?? totalSeconds

    return {
      '@type': 'Clip',
      'name': point.label,
      'startOffset': point.time,
      ...(endOffset !== null && endOffset > point.time ? { endOffset } : {}),
    }
  })
}

function buildVideoObjectLd(
  input: KeyGuidePageLdInput,
  video: CompleteKeyGuideVideo,
  videoId: string,
): Record<string, unknown> | null {
  const thumbnailUrl = resolveWebUrl(video.poster, input.baseUrl)
  const contentUrl = resolveWebUrl(video.src, input.baseUrl)

  if (!thumbnailUrl || !contentUrl) {
    return null
  }

  const clips = buildClipsLd(video)

  return {
    '@type': 'VideoObject',
    '@id': videoId,
    'name': video.caption || `${input.headline} (video)`,
    'description': input.description,
    'thumbnailUrl': thumbnailUrl,
    'uploadDate': video.uploadDate,
    'duration': video.duration,
    'contentUrl': contentUrl,
    'inLanguage': 'en',
    ...(clips.length ? { hasPart: clips } : {}),
  }
}

export function buildKeyGuidePageLd(input: KeyGuidePageLdInput) {
  const { '@context': context, ...articleLd } = buildGuidePageLd(input)
  const videoId = `${input.url}#video`
  const videoLd = isCompleteVideo(input.video)
    ? buildVideoObjectLd(input, input.video, videoId)
    : null

  const graph: Array<Record<string, unknown>> = [
    videoLd
      ? { ...articleLd, video: { '@id': videoId } }
      : articleLd,
  ]

  if (videoLd) {
    graph.push(videoLd)
  }

  return {
    '@context': context,
    '@graph': graph,
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
