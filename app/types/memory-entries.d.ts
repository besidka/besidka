import type { MemoryEntryChange } from '#shared/types/memory-api.d'

export type MemoryEntryModalChange = Omit<MemoryEntryChange, 'reason'> & {
  reason: MemoryEntryChange['reason'] | 'created'
}
