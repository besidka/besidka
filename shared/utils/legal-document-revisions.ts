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
    hash: '59a124392b6f2cf658cfc54e64159c7890a32a24eff40db7e289eec1efd5026c',
    classification: 'material',
    noticeId: '2026-11-experimental-features',
    note: 'Experimental features: per-account feature access, gradual '
      + 'rollouts and version tests (new purpose on legitimate interests), '
      + 'Labs opt-ins, the objection switch, the 12-month change log and '
      + 'the feature counters. Body still includes the '
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
    hash: '6adda7284ef2cc3f0893193c061470953763750bd56dc5edec91db3b519fc8e5',
    classification: 'minor',
    note: 'Removed the legal-notice:dismissed:* key; dismissal is now an '
      + 'account setting and nothing is stored in the browser for it.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
