export type LegalDocumentId
  = | 'privacy-policy'
    | 'terms-of-use'
    | 'cookie-policy'

export interface LegalNotice {
  id: string
  documents: readonly LegalDocumentId[]
  publishedAt: string
  sendFrom: string
  effectiveAt: string
  shortNoticeReason?: string
  summary: readonly string[]
}

export const LEGAL_DOCUMENT_IDS = [
  'privacy-policy',
  'terms-of-use',
  'cookie-policy',
] as const satisfies readonly LegalDocumentId[]

export const STANDARD_NOTICE_DAYS = 30

export const SHORT_NOTICE_DAYS = 14

export const NOTICE_ACTIVE_AFTER_EFFECTIVE_DAYS = 14

const MILLISECONDS_PER_DAY = 86_400_000

export const LEGAL_NOTICES = [
  {
    id: '2026-11-legal-notices',
    documents: ['privacy-policy', 'terms-of-use'],
    publishedAt: '2026-10-31T06:00:00Z',
    sendFrom: '2026-10-31T09:00:00Z',
    effectiveAt: '2026-12-01',
    summary: [
      'I now tell you about significant changes to the Privacy Policy, the '
      + 'Terms of Use and the Cookie Policy by email and with a notice in '
      + 'the app, at least 30 days before they take effect. Typo fixes and '
      + 'clarifications that do not change what I do take effect when '
      + 'published and only update the date.',
      'AI apps you connect to your account, such as Claude, can be given '
      + 'permission to change your data and, as a separate permission, to '
      + 'delete it. Deleting through an app is permanent, and each '
      + 'permission is off until you tick it. Apps you connected earlier '
      + 'do not have these permissions and have to ask you for them.',
      'You can remove single permissions from a connected app, or '
      + 'disconnect it, at any time in Profile → Connected apps. It takes '
      + 'effect on the app\'s next request.',
      'Each project has its own switch for automatic memory updates. It '
      + 'can follow your account setting, be turned on or be turned off for '
      + 'that project, independently of your account setting. Updates run '
      + 'on your own API key and only cover messages written after you '
      + 'turn them on.',
      'I delete the approval of a connected app automatically when it has '
      + 'no live token and the app has not been used for 30 days.',
    ],
  },
] as const satisfies readonly LegalNotice[]

export function parseNoticeInstant(value: string): number {
  return Date.parse(value)
}

export function parseNoticeEffectiveInstant(effectiveAt: string): number {
  return Date.parse(`${effectiveAt}T00:00:00Z`)
}

export function getNoticeLeadDays(notice: LegalNotice): number {
  return (
    parseNoticeEffectiveInstant(notice.effectiveAt)
    - parseNoticeInstant(notice.publishedAt)
  ) / MILLISECONDS_PER_DAY
}

export function getRequiredNoticeDays(notice: LegalNotice): number {
  return notice.shortNoticeReason ? SHORT_NOTICE_DAYS : STANDARD_NOTICE_DAYS
}

export function isLegalNoticePublished(
  notice: LegalNotice,
  now: Date,
): boolean {
  return parseNoticeInstant(notice.publishedAt) <= now.getTime()
}

export function isLegalNoticeActive(notice: LegalNotice, now: Date): boolean {
  const activeUntil = parseNoticeEffectiveInstant(notice.effectiveAt)
    + NOTICE_ACTIVE_AFTER_EFFECTIVE_DAYS * MILLISECONDS_PER_DAY

  return isLegalNoticePublished(notice, now) && now.getTime() < activeUntil
}

export function getLatestLegalNotice(
  now: Date,
  notices: readonly LegalNotice[] = LEGAL_NOTICES,
): LegalNotice | null {
  const published = notices.filter((notice) => {
    return isLegalNoticePublished(notice, now)
  })

  return published.at(-1) ?? null
}

export function getActiveLegalNotices(
  now: Date,
  notices: readonly LegalNotice[] = LEGAL_NOTICES,
): LegalNotice[] {
  return notices.filter((notice) => {
    return isLegalNoticeActive(notice, now)
  })
}

export function getLegalNoticeById(
  id: string,
  notices: readonly LegalNotice[] = LEGAL_NOTICES,
): LegalNotice | null {
  return notices.find((notice) => {
    return notice.id === id
  }) ?? null
}

export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return typeof value === 'string'
    && (LEGAL_DOCUMENT_IDS as readonly string[]).includes(value)
}
