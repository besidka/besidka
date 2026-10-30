import type {
  LegalDocumentId,
  LegalNotice,
} from '#shared/utils/legal-notices'
import { buildAlreadyAvailableNote } from '#shared/utils/legal-change-history'
import { parseNoticeEffectiveInstant } from '#shared/utils/legal-notices'

const SITE_ORIGIN = 'https://besidka.com'

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

const DOCUMENT_LABELS: Record<LegalDocumentId, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-of-use': 'Terms of Use',
  'cookie-policy': 'Cookie Policy',
}

export type LegalNoticeEmailProps = {
  preview: string
  heading: string
  intro: string
  summary: string[]
  effectiveDate: string
  documents: { label: string, url: string }[]
  contactEmail: string
  complaintUrl: string
  shortNoticeReason?: string
  availabilityNote?: string
}

export interface LegalNoticeEmailContent {
  subject: string
  props: LegalNoticeEmailProps
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels.join('')
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

export function formatNoticeEffectiveDate(notice: LegalNotice): string {
  const effective = new Date(parseNoticeEffectiveInstant(notice.effectiveAt))

  return `${effective.getUTCDate()} ${MONTH_NAMES[effective.getUTCMonth()]} `
    + `${effective.getUTCFullYear()}`
}

export function buildLegalNoticeEmail(
  notice: LegalNotice,
  contactEmail: string,
): LegalNoticeEmailContent {
  const labels = notice.documents.map((documentId) => {
    return DOCUMENT_LABELS[documentId]
  })
  const documentsLabel = joinLabels(labels)
  const effectiveDate = formatNoticeEffectiveDate(notice)
  const subject = `Changes to Besidka's ${documentsLabel} take effect on `
    + effectiveDate

  return {
    subject,
    props: {
      preview: subject,
      heading: `Changes to Besidka's ${documentsLabel}`,
      intro: `Here's what changes in Besidka's ${documentsLabel}:`,
      summary: [...notice.summary],
      effectiveDate,
      documents: notice.documents.map((documentId) => {
        return {
          label: DOCUMENT_LABELS[documentId],
          url: `${SITE_ORIGIN}/${documentId}#change-history`,
        }
      }),
      contactEmail,
      complaintUrl: `${SITE_ORIGIN}/privacy-policy#complaining`,
      ...(notice.alreadyAvailable
        ? {
          availabilityNote: buildAlreadyAvailableNote(
            effectiveDate,
            documentsLabel,
          ),
        }
        : {}),
      ...(notice.shortNoticeReason
        ? { shortNoticeReason: notice.shortNoticeReason }
        : {}),
    },
  }
}
