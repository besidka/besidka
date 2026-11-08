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
    hash: '4adb3a2a7befe7cda5bbd10175d39e4bb2102c8eafc4013a7e40dd1dbb7476ba',
    classification: 'material',
    noticeId: '2026-11-experimental-features',
    note: 'Experimental features: per-account feature access, gradual '
      + 'rollouts and version tests (new purpose on legitimate interests), '
      + 'Labs opt-ins, the objection switch, the 12-month change log and '
      + 'the feature counters. The Labs page is described as coming. '
      + 'Body still includes the '
      + '2026-11-legal-notices changes, effective 2026-12-04.',
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
