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
    hash: 'ae4fe9e053d0fa9a70f3fdecef7a9254c5ecbde647c7cbe7a8eb1b911079eba5',
    classification: 'material',
    noticeId: '2026-12-artifacts',
    note: 'Artifacts: stored content and versions, public artifact links, '
      + 'saved progress for signed-in visitors, AI requests on the '
      + 'visitor\'s key, the runtime host, the report form with Turnstile, '
      + 'report and removal-order retention, and the artifact MCP '
      + 'permissions. Body still includes the 2026-11-experimental-features '
      + 'changes, effective 2026-12-19.',
  },
  'terms-of-use': {
    hash: 'f031d8b6eedf821cdbe4c5f1db8fcd4f34aa027ad659599089f15b4e5afae741',
    classification: 'material',
    noticeId: '2026-12-artifacts',
    note: 'Artifact links and what the publisher promises, new prohibited '
      + 'uses for artifacts, the report form and its categories, the '
      + 'terrorist-content policy and removal-order contact point, artifact '
      + 'takedown and its statement of reasons, artifact AI marks.',
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
