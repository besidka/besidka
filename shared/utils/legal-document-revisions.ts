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
    hash: '8642e241ea8e5142ad8a438d4b44cf6331f79b705191f64f245b81e11a294620',
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
      + '2026-11-20. '
      + 'CONNECTORS (C-10, BES-257): the section Connectors you '
      + 'add, the recipient row, the transfer paragraph (explicit consent '
      + 'per connector, Art. 49(1)(a)), the legal-basis and retention rows '
      + '(tool-call log 90 days, registry copy) and the registry copy are '
      + 'judged MATERIAL (new purpose, new recipient category, new '
      + 'transfer, new retention) and are NOT described by the notice id on '
      + 'this record. No notice exists for connectors: '
      + 'announcing them is the owner\'s decision in /admin/legal. '
      + 'PHASE 4 LEGAL BATCH (2026-11-16): the new Skills section (sources, '
      + 'GitHub import, what is kept, catalog and text to the chat\'s '
      + 'provider, never public, scripts copied to the user\'s Anthropic '
      + 'workspace and deleted again), TypeSafe AI skill screening and the '
      + 'eighth, opt-in Skill selection check, connector modes (Auto, Always '
      + 'on, Manual) with the catalog sent to the provider, per-tool modes, '
      + 'the 30-day tool snapshot and the anonymous directory requests, with '
      + 'the matching recipient, transfer, logging, retention and deletion '
      + 'rows, and the paragraph on other people in a skill. Judged MATERIAL under WP260 (new purposes, new recipients '
      + 'GitHub and the Anthropic workspace copy, new retention) and NOT '
      + 'described by the notice id on this record. Owner decision of '
      + '2026-11-16: updated without notice emails, no LEGAL_NOTICES entry '
      + 'and no consent version bump. '
      + 'MERGE OF MAIN (2026-11-22): the connector approval paragraphs follow '
      + 'the owner decision of 2026-11-20 (a tool the user allowed runs '
      + 'without asking after content from another source and in the delete '
      + 'and share group, tools grouped by kind, long tasks in up to 10 '
      + 'rounds while the chat is open); part of the connectors text above '
      + 'and NOT described by the notice id on this record. After review: a '
      + 'tool the server labels read-only runs without asking on that '
      + 'unverifiable label, images connector tools return are kept with '
      + 'the chat as files, connector consent is withdrawn in the '
      + 'connector\'s settings, and support emails are an eighth limit of '
      + 'account deletion; also NOT described by that notice id, which is '
      + 'provisional.',
  },
  'terms-of-use': {
    hash: '9094d1ce24d1692ce6b6ae1935fdfd121a222b685b5c9be31ba90b5f290c226d',
    classification: 'material',
    noticeId: '2026-11-support-requests',
    note: 'Contact: support@besidka.com for help with the app, with a link '
      + 'to the Privacy Policy support section; the privacy address stays '
      + 'the single address for everything else. Body still includes the '
      + '2026-12-code-and-documents changes, effective 2026-12-19. Owner '
      + 'approved the notice and its dates in chat on 2026-11-20.'
      + ' CONNECTORS (C-10, BES-257): the Connectors section and edits to '
      + 'the key, sensitive-information, other-people\'s-data and liability '
      + 'sections (new duties for the account a user gives a connector, a '
      + 'call the user approved is the user\'s action, and more not-liable '
      + 'items) are judged MATERIAL and are NOT described by the notice id '
      + 'on this record. No notice exists for '
      + 'connectors: announcing them is the owner\'s decision in '
      + '/admin/legal. PHASE 4 LEGAL BATCH (2026-11-16): a new Skills '
      + 'section (right to use what you create, paste or import, no review '
      + 'by Besidka, scripts under the provider\'s terms, private skills, '
      + 'the power to disable a skill with a statement of reasons, '
      + 'reporting), a What you may not do item, skills in the Your content '
      + 'license and a skill check under Content moderation. Judged '
      + 'MATERIAL (new obligations on users) and NOT described by the '
      + 'notice id on this record. Owner decision of 2026-11-16: updated '
      + 'without notice emails, no LEGAL_NOTICES entry and no consent '
      + 'version bump. MERGE OF MAIN (2026-11-22): the Connectors section '
      + 'says an allowed tool, including one that deletes or shares, runs '
      + 'without asking even after outside text in the same message (owner '
      + 'decision of 2026-11-20); NOT described by the notice id on this '
      + 'record, which is provisional. After review, Who I am and Contact '
      + 'say the privacy address covers everything except help with the '
      + 'app, which has the support address (a clarification of the '
      + 'support text).',
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
