import type {
  LegalDocumentId,
  LegalNotice,
} from '#shared/utils/legal-notices'
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
  shortNoticeReason?: string
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

function buildIntro(documents: readonly LegalDocumentId[]): string {
  const changesTerms = documents.includes('terms-of-use')
  const changesData = documents.some((documentId) => {
    return documentId !== 'terms-of-use'
  })

  if (changesTerms && changesData) {
    return 'I\'m changing how Besidka handles your data and the rules for '
      + 'using it. Here\'s what changes:'
  }

  if (changesTerms) {
    return 'I\'m changing the rules for using Besidka. Here\'s what '
      + 'changes:'
  }

  return 'I\'m changing how Besidka handles your data. Here\'s what '
    + 'changes:'
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
      intro: buildIntro(notice.documents),
      summary: [...notice.summary],
      effectiveDate,
      documents: notice.documents.map((documentId) => {
        return {
          label: DOCUMENT_LABELS[documentId],
          url: `${SITE_ORIGIN}/${documentId}#change-history`,
        }
      }),
      contactEmail,
      ...(notice.shortNoticeReason
        ? { shortNoticeReason: notice.shortNoticeReason }
        : {}),
    },
  }
}
