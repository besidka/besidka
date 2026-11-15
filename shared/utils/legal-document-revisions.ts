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
    hash: '415b3b28633a41578f48a3d6e537a742bb0af87fbd086870b9894153c8c419e1',
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
      + 'retention. Also the two connected-app permissions for connectors '
      + '(see and add, switch off, restrict and delete; BES-256): they '
      + 'describe what MCP tools can do and cannot do (never switch a '
      + 'connector on, sign in or allow a tool without asking), and the '
      + 'wording about connectors as recipients stays with C-10; whether '
      + 'the existing notice needs to say more is the owner\'s decision. '
      + 'An earlier edit changed British spellings to American '
      + 'English, with no change of meaning, so it adds no new '
      + 'classification.',
  },
  'terms-of-use': {
    hash: '74f82cf285bd82700c1393da884409cb1626b78e8f336c0b3852e19a69f4bb0b',
    classification: 'material',
    noticeId: '2026-12-code-and-documents',
    note: 'New prohibited use for code run with Run code or written through '
      + 'Besidka (malware, denial of service, bypassing security controls, '
      + 'critical infrastructure), the provider\'s usage policy and '
      + 'Anthropic\'s skills, documents and code results not checked by '
      + 'Besidka, and the AI mark on documents. Body still includes the '
      + '2026-12-artifacts changes, effective 2026-12-19.'
      + ' Latest edit is spelling only (British variants changed to '
      + 'American English), with no change of meaning, so it adds no '
      + 'new classification.',
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
