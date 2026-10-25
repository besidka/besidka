import type { parseError } from 'evlog'
import type { MemorySettingsFields } from '#shared/types/memory.d'

export type MemorySaveResult = Partial<MemorySettingsFields>

export type MemorySaveError = ReturnType<typeof parseError>

export type MemorySaveOutcome
  = { ok: true, result: MemorySaveResult }
    | { ok: false, parsed: MemorySaveError }

export type MemorySettingsSave = (
  patch: Partial<MemorySettingsFields>,
) => Promise<MemorySaveOutcome>
