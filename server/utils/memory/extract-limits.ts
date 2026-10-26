import { MEMORY_IMPORT_MAX_CHARS } from '#shared/utils/memory-import-limits'

export const MEMORY_EXTRACTION_LIMITS = {
  idleMs: 10 * 60 * 1000,
  minUserChars: 300,
  perUserCapPerTick: 5,
  poolMultiplier: 4,
  attemptBackoffMs: 30 * 60 * 1000,
  maxFailures: 3,
  maxTranscriptChars: 36000,
  maxOpsPerPass: 10,
  maxOpsWithLegacyBlob: 15,
  maxOpsPerImportChunk: 20,
  generationTimeoutMs: 90000,
  generationTimeoutBackgroundMs: 150000,
  evidenceMinChars: 20,
  evidenceMinWords: 3,
  evidenceShortMinChars: 8,
  evidenceContentTokenMinChars: 4,
  evidenceStemMinChars: 5,
  branchCopyGraceMs: 30 * 1000,
  indexBodyBudgetChars: 48000,
  maxOutputTokens: 12000,
  maxMessagesScanned: 120,
  maxLegacyBlobChars: 4000,
  extractNowCooldownSeconds: 60,
  projectRefreshMaxChatsPerClick: 6,
  projectRefreshMaxRuntimeMs: 60_000,
  importChunkChars: 24000,
  importMaxChunksPerRequest: 3,
  importMaxChars: MEMORY_IMPORT_MAX_CHARS,
  importCooldownSeconds: 60,
  importMinChunkBudgetMs: 10_000,
  backfillChatsPerStep: 2,
  backfillChatsPerTick: 3,
  backfillJobsPerTick: 5,
  backfillStepDeadlineMs: 60000,
  backfillDriveCooldownSeconds: 10,
  extractionEnableCooldownSeconds: 10,
} as const

export const MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES = 0

export const MEMORY_EXTRACTION_EDITABLE_ORIGINS = [
  'extraction',
  'import',
] as const

export function isMemoryExtractionEditableOrigin(origin: string): boolean {
  return (MEMORY_EXTRACTION_EDITABLE_ORIGINS as readonly string[])
    .includes(origin)
}

export function clampMemoryExtractionOutputTokens(
  modelOutputLimit: number | null | undefined,
): number {
  if (
    typeof modelOutputLimit !== 'number'
    || !Number.isFinite(modelOutputLimit)
    || modelOutputLimit <= 0
  ) {
    return MEMORY_EXTRACTION_LIMITS.maxOutputTokens
  }

  return Math.min(
    MEMORY_EXTRACTION_LIMITS.maxOutputTokens,
    Math.floor(modelOutputLimit),
  )
}
