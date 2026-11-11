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
    hash: 'd42c3bd241a775f4e17fd36480a3ac543975d6667a5d4d8e050afd67931d7daf',
    classification: 'minor',
    note: 'Describes two opt-in features inside existing purposes, recipients '
      + 'and legal basis: documents (stored outline and file, deleted with '
      + 'the file and with the chat) and running code at the provider the '
      + 'user chose (what is sent, what Besidka deletes, what each provider '
      + 'keeps), plus create_document under the files permission of '
      + 'connected apps. Provider-side retention is the provider\'s, not '
      + 'Besidka\'s. Body still includes the 2026-11-experimental-features '
      + 'and 2026-12-artifacts changes, effective 2026-12-19.',
  },
  'terms-of-use': {
    hash: '2c0347a55ee3893d3d9852ee737e62fcd1f93cd02917973d9f89ce3f537dbc88',
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
