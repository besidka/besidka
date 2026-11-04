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
    hash: '9ed16390042063601702e2848cfc14c44ff111c8a6e0dd79b8c4b89e26fea941',
    classification: 'minor',
    note: 'Describes the machine-readable AI image marks (provider C2PA '
      + 'kept, otherwise an IPTC tag naming only the model); no new '
      + 'purpose, recipient or obligation. Body still includes the '
      + '2026-11-legal-notices changes, effective 2026-12-04.',
  },
  'cookie-policy': {
    hash: '767342201cf16e5041180bd8d8e7169273784c68a9618ef47614014c0547b0de',
    classification: 'minor',
    note: 'Change clause, change history and one necessary localStorage '
      + 'key (legal-notice:dismissed:*) that remembers a dismissed notice.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
