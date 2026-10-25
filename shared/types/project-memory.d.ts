import type { MemoryEntriesResponse } from '#shared/types/memory-api.d'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'

export interface ProjectMemoryCardResponse
  extends Pick<MemoryEntriesResponse, 'total' | 'limits' | 'groups'> {
  projectId: string
  memoryStatus: ProjectMemoryStatus
  memoryUpdatedAt: string | null
  memoryDirtyAt: string | null
  memoryProvider: string | null
  memoryModel: string | null
  memoryError: string | null
  usesEntries: boolean
  legacyMemory: string | null
}
