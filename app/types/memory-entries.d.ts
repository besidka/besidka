import type { MemoryEntry } from '#shared/types/memory.d'
import type { MemoryEntryChange } from '#shared/types/memory-api.d'

export type MemoryEntryModalChange = Omit<MemoryEntryChange, 'reason'> & {
  reason: MemoryEntryChange['reason'] | 'created'
}

export interface MemoryProjectSection {
  id: string
  name: string
  isMemoryOff: boolean
  entries: MemoryEntry[]
}
