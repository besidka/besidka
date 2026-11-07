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
    hash: 'cd5434daec92ffd66177be56ffbd4a4279605e8f543c4bbe9bf5dc3102f1f0c1',
    classification: 'minor',
    note: 'Settings list now names the dismissed in-app legal notices; a UI '
      + 'choice like the push prompt answer, same purpose, basis and '
      + 'retention. Body still includes the 2026-11-legal-notices changes, '
      + 'effective 2026-12-04.',
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
    hash: 'b8ab26cf96d8978d0818bff9915fca174222cd69560d6093d6544c3c5ddf097e',
    classification: 'minor',
    note: 'Added the besidka:side-panel-width Preferences row, a '
      + 'consent-gated UI width like settings_sidebar_pinned; no new purpose.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
