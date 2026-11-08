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
  alreadyAvailable?: boolean
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

export const SEND_WINDOW_BUFFER_DAYS = 3

const MILLISECONDS_PER_DAY = 86_400_000

export const LEGAL_NOTICES = [
  {
    id: '2026-11-legal-notices',
    documents: ['privacy-policy', 'terms-of-use'],
    publishedAt: '2026-10-31T06:00:00Z',
    sendFrom: '2026-10-31T09:00:00Z',
    effectiveAt: '2026-12-04',
    alreadyAvailable: true,
    summary: [
      'I now tell you about significant changes to my legal pages by email '
      + 'and with a notice in the app, at least 30 days before they take '
      + 'effect (14 days, with the reason, when the law or security '
      + 'requires it). Typo fixes and clarifications that do not change '
      + 'what I do take effect when published and only update the date.',
      'Connected AI apps such as Claude can now be given more permissions, '
      + 'including changing your chats, files and settings and, as a '
      + 'separate permission, deleting your data. The change and delete '
      + 'permissions are off until you tick them. Apps you connected '
      + 'earlier keep what you approved and have to ask you for the new '
      + 'permissions.',
      'You can remove single permissions from a connected app, or '
      + 'disconnect it, at any time in Profile → Connected apps. It takes '
      + 'effect on the app\'s next request.',
      'Each project has its own switch for automatic memory updates. It '
      + 'can follow your account setting, be turned on or be turned off for '
      + 'that project, independently of your account setting. Updates run '
      + 'on your own API key and only cover messages written after you '
      + 'turn them on. Nothing is turned on for you.',
      'I delete the approval of a connected app automatically when it has '
      + 'no live token and the app has not been used for 30 days.',
    ],
  },
  {
    id: '2026-11-experimental-features',
    documents: ['privacy-policy'],
    publishedAt: '2026-11-15T06:00:00Z',
    sendFrom: '2026-11-15T09:00:00Z',
    effectiveAt: '2026-12-19',
    summary: [
      'New features can reach a share of accounts first. Which accounts '
      + 'are chosen is random, worked out from the account number and a '
      + 'random value kept for each feature: nothing about you, such as your '
      + 'country, your email address or how you use Besidka, plays a part. '
      + 'For features that do not use your API keys I may also show '
      + 'different versions to compare them. Both start no earlier than '
      + '19 December 2026.',
      'I keep a record of the roles and features I set for your account by '
      + 'hand, and of which features that use your keys you switched on '
      + 'yourself on the new Labs page. A feature that uses your keys never '
      + 'switches on without your own switch.',
      'Changes to feature access are logged for 12 months. If you delete '
      + 'your account, your account id and the notes are removed from that '
      + 'log. Short log lines about these decisions and changes are kept for '
      + '30 days.',
      'Rollouts, version tests and the change log rest on my legitimate '
      + 'interests: releasing features safely and learning which version '
      + 'works. You can object to rollouts and version tests at any time by '
      + 'email, and with a switch on the Labs page once it is there. You '
      + 'keep any feature I turned on for you by hand.',
    ],
  },
  {
    id: '2026-12-artifacts',
    documents: ['privacy-policy', 'terms-of-use'],
    publishedAt: '2026-11-15T07:00:00Z',
    sendFrom: '2026-11-15T10:00:00Z',
    effectiveAt: '2026-12-19',
    summary: [
      'Artifacts: the assistant, or an AI app you connect, can make pages, '
      + 'interactive components, diagrams and documents that run in a sealed '
      + 'frame next to the chat. I keep every version until you delete the '
      + 'artifact or your account. Deleting a chat keeps its artifacts. Later '
      + 'messages in the chat send its artifacts to the chat\'s AI provider. '
      + 'They reach accounts step by step, first by hand to me and to testers.',
      'You can publish an artifact by link. Anyone with the link can open '
      + 'it without an account, search engines never index it, and the page '
      + 'says it was made by AI and not reviewed by me. Links an AI app '
      + 'creates expire within 30 days. At first only accounts I invite can '
      + 'publish artifacts.',
      'If its author allows it, a signed-in visitor can save progress in an '
      + 'artifact and let it ask an AI model with their own API key after '
      + 'confirming the request. The author never sees saved progress in '
      + 'Besidka, but the artifact\'s own code does. I store neither the '
      + 'request nor the answer. Both features start only after I ask for '
      + 'your consent to a text that names them.',
      'Anyone can report an artifact with a form on its page. The Terms '
      + 'now forbid artifacts that imitate a sign-in or payment form, ask '
      + 'visitors for passwords, payment details, who they are or how to '
      + 'contact them, redirect them, try to spend their keys, are aimed at '
      + 'children under 13 or serve as website hosting.',
      'The Terms also say how I handle removal orders for terrorist content '
      + '(within one hour, and the removed content kept for six months as the '
      + 'law requires). Reports about an artifact are kept for 12 months after '
      + 'they are closed, also after the artifact or the account is deleted.',
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

export function getNoticeSendLeadDays(notice: LegalNotice): number {
  return (
    parseNoticeEffectiveInstant(notice.effectiveAt)
    - parseNoticeInstant(notice.sendFrom)
  ) / MILLISECONDS_PER_DAY
}

export function getRequiredNoticeSendLeadDays(notice: LegalNotice): number {
  return getRequiredNoticeDays(notice) + SEND_WINDOW_BUFFER_DAYS
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
