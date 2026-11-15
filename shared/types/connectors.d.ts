import type {
  ConnectorAuthType,
  ConnectorCreatedVia,
  ConnectorStatus,
} from '#shared/utils/connectors-policy'

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

export interface ConnectorDirectoryItem {
  id: string
  name: string
  title: string | null
  description: string
  remoteUrl: string
  authHint: 'header' | 'unknown'
  presetId: string | null
}
