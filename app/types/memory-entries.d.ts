import type { MemoryCategory, MemoryEntry } from '#shared/types/memory.d'
import type { MemoryEntryChange } from '#shared/types/memory-api.d'

export type MemoryEntryModalChange = Omit<MemoryEntryChange, 'reason'> & {
  reason: MemoryEntryChange['reason'] | 'created'
}

export interface MemoryProjectSection {
  id: string
  name: string
  isMemoryOff: boolean
  isArchived: boolean
  entries: MemoryEntry[]
}

export interface MemoryEntryInitialValues {
  title: string
  description: string
  body: string
  category: MemoryCategory
}
