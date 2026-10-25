import type { MemoryCategory, MemoryOrigin } from '#shared/types/memory.d'
import { formatActivityAge } from '#shared/utils/date-groups'
import { memoryCategories } from '#shared/utils/memory-policy'

export const memoryCategoryOrder: readonly MemoryCategory[] = memoryCategories

export const memoryCategoryLabels: Record<MemoryCategory, string> = {
  profile: 'Profile',
  preferences: 'Preferences',
  areas: 'Areas',
  topics: 'Topics',
  people: 'People',
}

export const memoryOriginLabels: Record<MemoryOrigin, string> = {
  user: 'You',
  extraction: 'Extracted from chats',
  tool: 'Saved in chat',
  import: 'Imported',
}

export function getMemoryEntryOriginLabel(origin: MemoryOrigin): string {
  return memoryOriginLabels[origin]
}

export function formatMemoryUpdatedAge(date: Date): string {
  return formatActivityAge(date).replace(/^Last activity /, '')
}
