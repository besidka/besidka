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
    hash: '2ad1b675898da2bd365b671fff165f57e44112a48e73660e1083574e4fc6dd75',
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
      + 'retention.',
  },
  'terms-of-use': {
    hash: '932cd71ac59355cde03b3ac7edf4b5bba2565374b97e13579305dfd4cfee2b05',
    classification: 'material',
    noticeId: '2026-12-code-and-documents',
    note: 'New prohibited use for code run with Run code or written through '
      + 'Besidka (malware, denial of service, bypassing security controls, '
      + 'critical infrastructure), the provider\'s usage policy and '
      + 'Anthropic\'s skills, documents and code results not checked by '
      + 'Besidka, and the AI mark on documents. Body still includes the '
      + '2026-12-artifacts changes, effective 2026-12-19.',
  },
  'cookie-policy': {
    hash: 'c7809319c1007ef392fcd62dca5eb0e9880487b76fecced602c0c01cc7118c02',
    classification: 'minor',
    note: 'Turnstile also on the artifact report form for signed-out '
      + 'visitors (same bot-protection purpose and recipient), the '
      + 'artifacts:auto-opened and artifacts:share-return sessionStorage '
      + 'rows, and no Web Analytics on public artifact pages; no new '
      + 'cookie, purpose or recipient.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
