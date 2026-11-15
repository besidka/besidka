export type ToolApprovalGrantScope = 'chat' | 'always'

export interface ToolApprovalGrantItem {
  scope: ToolApprovalGrantScope
  connectorId: string
  connectorTitle: string
  toolName: string
  source?: 'besidka'
}

export interface ChatToolApprovalGrants {
  grants: ToolApprovalGrantItem[]
}
