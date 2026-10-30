import { LEGAL_NOTICES, isLegalNoticePublished } from '#shared/utils/legal-notices'
import type {
  LegalDocumentId,
  LegalNotice,
} from '#shared/utils/legal-notices'

export interface LegalChangeHistoryItem {
  id: string
  publishedAt: string
  publishedLabel: string
  effectiveAt: string
  effectiveLabel: string
  summary: readonly string[]
}

export const LEGAL_CHANGE_HISTORY_EMPTY_TEXT
  = 'No material changes have been announced yet.'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export function formatLegalDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const month = MONTH_NAMES[Number(match?.[2]) - 1]

  if (!match || !month) {
    return value
  }

  return `${Number(match[3])} ${month} ${match[1]}`
}

export function buildLegalChangeHistoryItems(
  documentId?: LegalDocumentId,
  now: Date = new Date(),
  notices: readonly LegalNotice[] = LEGAL_NOTICES,
): LegalChangeHistoryItem[] {
  return notices
    .filter((notice) => {
      return isLegalNoticePublished(notice, now)
        && (!documentId || notice.documents.includes(documentId))
    })
    .map((notice) => {
      return {
        id: notice.id,
        publishedAt: notice.publishedAt,
        publishedLabel: formatLegalDate(notice.publishedAt),
        effectiveAt: notice.effectiveAt,
        effectiveLabel: formatLegalDate(notice.effectiveAt),
        summary: notice.summary,
      }
    })
    .reverse()
}

export function buildLegalChangeHistoryMarkdown(
  documentId?: LegalDocumentId,
  now: Date = new Date(),
  notices: readonly LegalNotice[] = LEGAL_NOTICES,
): string {
  const items = buildLegalChangeHistoryItems(documentId, now, notices)

  if (items.length === 0) {
    return LEGAL_CHANGE_HISTORY_EMPTY_TEXT
  }

  return items
    .map((item) => {
      const bullets = item.summary.map((line) => {
        return `- ${line}`
      })

      return [
        `**Announced ${item.publishedLabel}, in effect from `
        + `${item.effectiveLabel}**`,
        '',
        ...bullets,
      ].join('\n')
    })
    .join('\n\n')
}
