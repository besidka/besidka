export type ToolApprovalGrantScope = 'chat' | 'always'

export interface ToolApprovalGrantItem {
  scope: ToolApprovalGrantScope
  connectorId: string
  connectorTitle: string
  toolName: string
  source?: 'besidka' | 'google' | 'google-egress'
}

export interface ChatToolApprovalGrants {
  grants: ToolApprovalGrantItem[]
}
