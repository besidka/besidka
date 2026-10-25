import type { parseError } from 'evlog'
import type { MemorySettingsFields } from '#shared/types/memory.d'

export interface MemorySaveResult extends Partial<MemorySettingsFields> {
  sensitiveEntriesDeleted?: number
}

export type MemorySaveError = ReturnType<typeof parseError>

export type MemorySaveOutcome
  = { ok: true, result: MemorySaveResult }
    | { ok: false, parsed: MemorySaveError }

export type MemorySettingsSave = (
  patch: Partial<MemorySettingsFields>,
) => Promise<MemorySaveOutcome>
