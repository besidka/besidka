import type {
  memoryCategories,
  memoryModelSources,
  memoryOrigins,
  memoryScopes,
  memorySensitiveCategories,
  memorySensitivities,
  neverStoreKindIds,
} from '#shared/utils/memory-policy'
import type { GatewayId } from '#shared/types/gateways.d'
import type { SupportedProviderId } from '#shared/types/providers.d'

export type MemoryScope = typeof memoryScopes[number]

export type MemoryCategory = typeof memoryCategories[number]

export type MemorySensitivity = typeof memorySensitivities[number]

export type MemoryOrigin = typeof memoryOrigins[number]

export type MemorySensitiveCategory = typeof memorySensitiveCategories[number]

export type MemoryModelSource = typeof memoryModelSources[number]

export type NeverStoreKind = typeof neverStoreKindIds[number]

export interface MemoryEntry {
  id: string
  projectId: string | null
  category: MemoryCategory
  slug: string
  title: string
  description: string
  body: string
  sensitivity: MemorySensitivity
  sensitiveCategory: MemorySensitiveCategory | null
  origin: MemoryOrigin
  sourceChatIds: string[]
  sourceMessageId: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

export type MemoryIndexEntry = Pick<
  MemoryEntry,
  'id' | 'projectId' | 'category' | 'slug' | 'title' | 'description'
> & {
  body: string | null
}

export interface MemoryEntryInput {
  projectId?: string | null
  category: MemoryCategory
  slug?: string
  title: string
  description: string
  body: string
  sensitivity?: MemorySensitivity
  sensitiveCategory?: MemorySensitiveCategory | null
  origin?: MemoryOrigin
}

export type MemoryEntryPatch = Partial<Pick<
  MemoryEntryInput,
  | 'title'
  | 'description'
  | 'body'
  | 'category'
  | 'sensitivity'
  | 'sensitiveCategory'
>>

export interface MemoryModelChoice {
  model: string | null
  gateway: GatewayId | null
}

export interface MemorySettingsFields {
  memoryEnabled: boolean
  chatSearchEnabled: boolean
  memoryIncludeSensitive: boolean
  aboutMe: string | null
  profileMemoryModel: string | null
  profileMemoryGateway: GatewayId | null
  projectMemoryModel: string | null
  projectMemoryGateway: GatewayId | null
}

export interface ResolvedMemoryModelSelection {
  scope: MemoryScope
  source: MemoryModelSource
  providerId: SupportedProviderId | null
  gatewayId: GatewayId | null
  modelId: string
  modelName: string
}

export type ComplianceBlockedCounts = Partial<Record<NeverStoreKind, number>>
