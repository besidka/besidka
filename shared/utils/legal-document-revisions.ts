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
    hash: '6030f8c37e93d81b31c997b82779cd2c0357c5fef3da55501405090b2bd0250b',
    classification: 'material',
    noticeId: '2026-12-code-and-documents',
    note: 'Documents (stored outline and file, deleted with the file and '
      + 'with the chat) and running code at the provider the user chose '
      + '(what is sent, what Besidka deletes, what each provider keeps), '
      + 'and create_document under the files permission of connected apps. '
      + 'Treated as material on the cautious reading: the provider-side '
      + 'retention is a retention fact users did not have before. The '
      + 'deletion wording is exact: uploads, the files the sandbox made and '
      + 'the OpenAI container are deleted when the reply ends; uploads expire '
      + 'within an hour if it is cut off, and files the Anthropic sandbox '
      + 'made stay in the user\'s Anthropic account. Body '
      + 'still includes the 2026-11-experimental-features and '
      + '2026-12-artifacts changes, effective 2026-12-19. Also minor '
      + 'clarifications (BES-393): artifacts count against the one storage '
      + 'limit instead of a separate 25 MB, and Read your settings includes '
      + 'storage use by type; no new purpose, recipient, transfer or '
      + 'retention. CONNECTORS (C-10, BES-257): the section Connectors you '
      + 'add, the recipient row, the transfer paragraph (explicit consent '
      + 'per connector, Art. 49(1)(a)), the legal-basis and retention rows '
      + '(tool-call log 90 days, registry copy) and the registry copy are '
      + 'judged MATERIAL (new purpose, new recipient category, new '
      + 'transfer, new retention) and are NOT described by the notice id on '
      + 'this record, which predates them. No notice exists for connectors: '
      + 'announcing them is the owner\'s decision in /admin/legal. '
      + 'Also the two connected-app permissions for connectors '
      + '(see and add, switch off, restrict and delete; BES-256): they '
      + 'describe what MCP tools can do and cannot do (never switch a '
      + 'connector on, sign in or allow a tool without asking), and the '
      + 'wording about connectors as recipients stays with C-10; whether '
      + 'the existing notice needs to say more is the owner\'s decision. '
      + 'Also the two connected-app permissions for skills (see skills and '
      + 'their full text; add, change and delete skills, saved switched off '
      + 'for review; BES-292), with skill deletes under that permission and '
      + 'not under Delete your data: '
      + 'they describe what MCP tools can do and cannot do (never switch a '
      + 'skill on or set it to Auto), with no new purpose, recipient, '
      + 'transfer or retention; whether the existing notice needs to say '
      + 'more is the owner\'s decision. '
      + 'An earlier edit changed British spellings to American '
      + 'English, with no change of meaning, so it adds no new '
      + 'classification.',
  },
  'terms-of-use': {
    hash: '0ed3e797911d7fb10e00c9c56051e257d416a6095972b6231e507613510c1031',
    classification: 'material',
    noticeId: '2026-12-code-and-documents',
    note: 'New prohibited use for code run with Run code or written through '
      + 'Besidka (malware, denial of service, bypassing security controls, '
      + 'critical infrastructure), the provider\'s usage policy and '
      + 'Anthropic\'s skills, documents and code results not checked by '
      + 'Besidka, and the AI mark on documents. Body still includes the '
      + '2026-12-artifacts changes, effective 2026-12-19.'
      + ' CONNECTORS (C-10, BES-257): the Connectors section and edits to '
      + 'the key, sensitive-information, other-people\'s-data and liability '
      + 'sections (new duties for the account a user gives a connector, a '
      + 'call the user approved is the user\'s action, and more not-liable '
      + 'items) are judged MATERIAL and are NOT described by the notice id '
      + 'on this record, which predates them. No notice exists for '
      + 'connectors: announcing them is the owner\'s decision in '
      + '/admin/legal. Latest earlier edit is spelling only (British '
      + 'variants changed to American English), with no change of meaning, '
      + 'so it adds no new classification.',
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
