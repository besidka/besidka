import type {
  ArtifactReportDecision,
  ArtifactReportStatus,
  ArtifactShareStatus,
  ArtifactTakedownScope,
} from '#shared/utils/artifacts'

export const REPORT_STATUS_LABELS: Record<ArtifactReportStatus, string> = {
  open: 'Open',
  actioned: 'Actioned',
  rejected: 'Rejected',
}

export const REPORT_DECISION_LABELS: Record<ArtifactReportDecision, string> = {
  'removed': 'Removed',
  'restricted': 'Link disabled',
  'no-action': 'No action',
}

export const SHARE_STATUS_LABELS: Record<ArtifactShareStatus, string> = {
  'active': 'active',
  'expired': 'expired',
  'revoked': 'turned off',
  'taken-down': 'taken down',
}

export const TAKEDOWN_SCOPE_LABELS: Record<ArtifactTakedownScope, string> = {
  share: 'One link',
  artifact: 'The artifact everywhere',
  user: 'Every artifact of the owner',
}
