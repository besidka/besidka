import type {
  MemoryCategory,
  MemoryOrigin,
  MemorySensitiveCategory,
} from '#shared/types/memory.d'
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

export const memorySensitiveCategoryLabels: Record<
  MemorySensitiveCategory,
  string
> = {
  'health': 'health',
  'religion-or-belief': 'religion or belief',
  'political-opinion': 'political opinion',
  'racial-or-ethnic-origin': 'racial or ethnic origin',
  'sex-life-or-orientation': 'sex life or orientation',
  'trade-union': 'trade union membership',
  'genetic': 'genetic data',
  'biometric': 'biometric data',
  'legal-dispute': 'legal disputes',
  'drugs': 'drugs',
}

export function getMemoryEntryOriginLabel(origin: MemoryOrigin): string {
  return memoryOriginLabels[origin]
}
