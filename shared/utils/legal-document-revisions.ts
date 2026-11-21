import type { LegalDocumentId } from '#shared/utils/legal-notices'

export type LegalRevisionClassification = 'material' | 'minor'

export interface LegalDocumentRevision {
  hash: string
  classification: LegalRevisionClassification
  noticeId?: string
  note: string
}

export const LEGAL_DOCUMENT_REVISIONS = {
  'privacy-policy': {
    hash: 'ab30dd635f4fff8c39774f17cc39539b92bbb3206457f517313ebeba3d089bba',
    classification: 'material',
    noticeId: '2026-11-support-requests',
    note: 'Support requests (new purpose): support@besidka.com, the debug '
      + 'block from get_debug_info and Copy debug info, lookup by ids in D1 '
      + 'and Axiom, the chat itself only on request or with agreement, '
      + 'basis 6(1)(b) or (f), closed plus 12 months. New recipient: Google '
      + '(Gmail), the owner\'s personal mailbox every besidka.com alias is '
      + 'forwarded to, with US transfer under the DPF. Read your chats now '
      + 'also covers debug details, chat cost and usage statistics '
      + '(get_debug_info, get_chat_cost, get_usage_stats). Body still '
      + 'includes the 2026-12-code-and-documents changes, effective '
      + '2026-12-19. Owner approved the notice and its dates in chat on '
      + '2026-11-20.',
  },
  'terms-of-use': {
    hash: 'ea8bea655aff9ae6cf4f5ba5849d7361776fee83ea70163e8e667af546e5d985',
    classification: 'material',
    noticeId: '2026-11-support-requests',
    note: 'Contact: support@besidka.com for help with the app, with a link '
      + 'to the Privacy Policy support section; the privacy address stays '
      + 'the single address for everything else. Body still includes the '
      + '2026-12-code-and-documents changes, effective 2026-12-19. Owner '
      + 'approved the notice and its dates in chat on 2026-11-20.',
  },
  'cookie-policy': {
    hash: '23698e9dfcd63b36e96015181acd14ee63db8d28cf75e09ea09993897450f58c',
    classification: 'minor',
    note: 'Turnstile also on the artifact report form for signed-out '
      + 'visitors (same bot-protection purpose and recipient), the '
      + 'artifacts:auto-opened and artifacts:share-return sessionStorage '
      + 'rows, and no Web Analytics on public artifact pages; no new '
      + 'cookie, purpose or recipient.'
      + ' Latest edit is spelling only (British variants changed to '
      + 'American English), with no change of meaning, so it adds no '
      + 'new classification.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
