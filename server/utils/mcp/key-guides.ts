import type { ProviderMeta } from '#shared/utils/provider-meta'
import { minimarkToMarkdown } from '~~/server/utils/mcp/minimark'
import type { MinimarkBody } from '~~/server/utils/mcp/minimark'

const GUIDES_PATH_PREFIX = '/guides/'

export interface KeyGuideIndexEntry {
  path: string
  provider: string
  title: string
}

export interface KeyGuideRecord extends KeyGuideIndexEntry {
  description: string
  summary?: string
  updatedAt: string
  checkedAt: string
  keyUrl: string
  keyUrlLabel?: string
  requirements: {
    card: boolean
    cardNote?: string
    minimumTopUp?: string
    freeTier?: string
    sources: { label: string, url: string }[]
  }
  faq?: { question: string, answer: string }[]
  body: MinimarkBody
}

export interface ProviderListEntry {
  id: string
  label: string
  kind: ProviderMeta['kind']
  apiKeyDashboardUrl: string
  keyFields: string[]
  keyGuide: { slug: string, url: string } | null
}

export function toGuideSlug(path: string): string {
  return path.startsWith(GUIDES_PATH_PREFIX)
    ? path.slice(GUIDES_PATH_PREFIX.length)
    : path
}

export function toGuideUrl(siteOrigin: string, path: string): string {
  return `${siteOrigin}${path}`
}

export function listProviders(
  providerMetas: Record<string, ProviderMeta>,
  guides: KeyGuideIndexEntry[],
  siteOrigin: string,
): ProviderListEntry[] {
  return Object.values(providerMetas).map((meta) => {
    const guide = guides.find((entry) => {
      return entry.provider === meta.id
    })

    return {
      id: meta.id,
      label: meta.label,
      kind: meta.kind,
      apiKeyDashboardUrl: meta.dashboardUrl,
      keyFields: meta.keyFields.map((field) => {
        return field.name
      }),
      keyGuide: guide
        ? {
          slug: toGuideSlug(guide.path),
          url: toGuideUrl(siteOrigin, guide.path),
        }
        : null,
    }
  })
}

export function findGuideEntry(
  guides: KeyGuideIndexEntry[],
  identifier: string,
): KeyGuideIndexEntry | null {
  const normalized = identifier.trim().toLowerCase()

  const byProvider = guides.find((entry) => {
    return entry.provider.toLowerCase() === normalized
  })

  if (byProvider) {
    return byProvider
  }

  return guides.find((entry) => {
    return toGuideSlug(entry.path).toLowerCase() === normalized
  }) ?? null
}

export function formatKeyGuide(guide: KeyGuideRecord, siteOrigin: string) {
  return {
    slug: toGuideSlug(guide.path),
    provider: guide.provider,
    title: guide.title,
    url: toGuideUrl(siteOrigin, guide.path),
    summary: guide.summary ?? undefined,
    updatedAt: guide.updatedAt,
    checkedAt: guide.checkedAt,
    apiKeyUrl: guide.keyUrl,
    requirements: guide.requirements,
    faq: guide.faq ?? undefined,
    stepsMarkdown: minimarkToMarkdown(guide.body),
  }
}
