import type {
  ComplianceBlockedCounts,
  MemoryCategory,
  MemoryEntry,
  MemoryModelSource,
} from '#shared/types/memory.d'
import type { GatewayId } from '#shared/types/gateways.d'

export type MemoryInstructOperationKind = 'create' | 'update' | 'delete'

export type MemoryInstructOperationStatus = 'ready' | 'rejected'

export interface MemoryInstructEntryFields {
  title: string
  description: string
  body: string
}

export interface MemoryInstructRejection {
  message: string
  why: string
}

export interface MemoryInstructPreviewOperation {
  key: string
  kind: MemoryInstructOperationKind
  status: MemoryInstructOperationStatus
  category: MemoryCategory
  id: string | null
  updatedAt: string | null
  before: MemoryInstructEntryFields | null
  after: MemoryInstructEntryFields | null
  reason: string | null
  rejection: MemoryInstructRejection | null
}

export interface MemoryInstructModelInfo {
  source: MemoryModelSource
  providerId: string | null
  gatewayId: GatewayId | null
  modelId: string
  modelName: string
}

export interface MemoryInstructCapacity {
  total: number
  limit: number
}

export interface MemoryInstructPreviewResponse {
  projectId: string | null
  operations: MemoryInstructPreviewOperation[]
  blocked: ComplianceBlockedCounts
  model: MemoryInstructModelInfo
  capacity: MemoryInstructCapacity
}

export interface MemoryInstructApplyResponse {
  projectId: string | null
  created: number
  updated: number
  deleted: number
  skipped: number
  entries: MemoryEntry[]
  deletedIds: string[]
}
