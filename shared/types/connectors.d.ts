import type {
  ConnectorAuthType,
  ConnectorCreatedVia,
  ConnectorStatus,
  ConnectorToolMode,
} from '#shared/utils/connectors-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export type ConnectorConsentState
  = | 'missing'
    | 'current'
    | 'outdated'
    | 'withdrawn'

export interface ConnectorPageNote {
  code: string
  message: string
}

export interface ConnectorPageToolCounts {
  isBaselined: boolean
  total: number
  enabled: number
  alwaysAllowed: number
}

export interface ConnectorPageItem {
  id: string
  slug: string
  title: string
  host: string
  status: ConnectorStatus
  enabled: boolean
  toolMode: ConnectorToolMode
  authType: ConnectorAuthType | null
  createdVia: ConnectorCreatedVia
  presetId: string | null
  addedByApp: string | null
  consent: {
    state: ConnectorConsentState
    issuerHost: string | null
    givenAt: string | null
  }
  note: ConnectorPageNote | null
  tools: ConnectorPageToolCounts
  createdAt: string
  updatedAt: string
  lastConnectedAt: string | null
}

export type ConnectorToolChange = 'none' | 'added' | 'changed' | 'new'

export interface ConnectorReviewTool {
  name: string
  title: string | null
  description: string
  readOnly: boolean
  destructive: boolean
  openWorld: boolean | null
  alwaysAsk: boolean
  change: ConnectorToolChange
  enabled: boolean
  alwaysAllowed: boolean
  mode: ToolPermissionMode
  canAlwaysAllow: boolean
}

export interface ConnectorToolsReview {
  state: 'ok'
  isBaselined: boolean
  reviewToken: string
  tools: ConnectorReviewTool[]
  removed: string[]
  counts: {
    total: number
    enabled: number
    pending: number
    perMessageLimit: number
  }
}

export interface ConnectorToolsUnavailable {
  state: 'unavailable'
  code: string
  message: string
}

export type ConnectorToolsListing
  = | ConnectorToolsReview
    | ConnectorToolsUnavailable

export type ConnectorDirectoryAuthKind = 'oauth' | 'header' | 'none' | 'unknown'

export interface ConnectorDirectoryItem {
  id: string
  name: string
  title: string
  description: string
  remoteUrl: string
  host: string
  authHint: 'header' | 'unknown'
  presetId: string | null
  publisher: string | null
  isOfficial: boolean
  isCurated: boolean
  category: string
  isAdded: boolean
  addedConnectorId: string | null
}

export interface ConnectorDirectoryCategorySection {
  id: string
  label: string
  count: number
  items: ConnectorDirectoryItem[]
}

export interface ConnectorDirectoryHome {
  top: ConnectorDirectoryItem[]
  topCount: number
  new: ConnectorDirectoryItem[]
  newCount: number
  categories: ConnectorDirectoryCategorySection[]
  total: number
  syncing?: true
}

export interface ConnectorDirectoryTool {
  name: string
  title: string | null
  description: string
}

export interface ConnectorDirectoryProbe {
  authKind: ConnectorDirectoryAuthKind
  state: 'listed' | 'needs-auth' | 'unavailable'
  tools: ConnectorDirectoryTool[]
  checkedAt: string
}
