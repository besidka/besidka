import type { parseError } from 'evlog'
import type { MemorySettingsFields } from '#shared/types/memory.d'

export type MemoryUiSettings = MemorySettingsFields & {
  memoryExtractionEnabled: boolean
}

export interface MemorySaveResult extends Partial<MemoryUiSettings> {
  sensitiveEntriesDeleted?: number
}

export type MemorySaveError = ReturnType<typeof parseError>

export type MemorySaveOutcome
  = { ok: true, result: MemorySaveResult }
    | { ok: false, parsed: MemorySaveError }

export type MemorySettingsSave = (
  patch: Partial<MemoryUiSettings>,
) => Promise<MemorySaveOutcome>
