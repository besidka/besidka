import type {
  MemoryCategory,
  MemoryEntryPatch,
} from '#shared/types/memory.d'
import type { SearchStepState } from '~/types/search-step.d'

export type MemoryStepToolName
  = 'memory_list'
    | 'memory_read'
    | 'memory_write'
    | 'memory_forget'

export type MemoryStepScope = 'account' | 'project'

export type MemoryStepAction = 'created' | 'updated'

export interface MemoryStepEntry {
  title: string
  category: MemoryCategory
  scope: MemoryStepScope
  id?: string
}

export type MemoryStepPrevious = Required<Pick<
  MemoryEntryPatch,
  'category' | 'title' | 'description' | 'body'
>> & Pick<MemoryEntryPatch, 'sensitivity' | 'sensitiveCategory'>

export interface MemoryStepData {
  toolName: MemoryStepToolName
  state: SearchStepState
  entries: MemoryStepEntry[]
  action?: MemoryStepAction
  entryId?: string
  previous?: MemoryStepPrevious
  errorReason: string
}
