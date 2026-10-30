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
    hash: '481db37e660361ad7d9ed82427672a17d2e8f159cd32cf56a1602125f810df05',
    classification: 'material',
    noticeId: '2026-11-legal-notices',
    note: 'Change notice clause, connected-app permissions and per-project '
      + 'memory updates.',
  },
  'terms-of-use': {
    hash: '7e5cf76de1bed9fef15a739e962d50b9075c170009c3da45d522433ff5e0de5f',
    classification: 'material',
    noticeId: '2026-11-legal-notices',
    note: 'Change notice clause and connected-app permissions.',
  },
  'cookie-policy': {
    hash: '3f7cdc84eeaba26695783a9fa21754b80eef9561d1f2534f8300ecd13c6aaf21',
    classification: 'minor',
    note: 'Change clause and change history reference only, no new storage.',
  },
} as const satisfies Record<LegalDocumentId, LegalDocumentRevision>
