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
    hash: '912e35671a8add52847d1170b604f8a4ba04d0329a693a870aeacbc22947817c',
    classification: 'material',
    noticeId: '2026-11-legal-notices',
    note: 'Change notice clause, its email, recipients, timing and legal '
      + 'basis, connected-app permissions and per-project memory updates.',
  },
  'terms-of-use': {
    hash: '75ad669cf6a09256d41e6c228d8d93c38f0d8067b6ffe4fe75807801ac54f995',
    classification: 'material',
    noticeId: '2026-11-legal-notices',
    note: 'Change notice clause, its recipients and timing, and '
      + 'connected-app permissions.',
  },
  'cookie-policy': {
    hash: '767342201cf16e5041180bd8d8e7169273784c68a9618ef47614014c0547b0de',
    classification: 'minor',
    note: 'Change clause, change history and one necessary localStorage '
      + 'key (legal-notice:dismissed:*) that remembers a dismissed notice.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
