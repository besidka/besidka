import {
  isStoredFindingCountsStale,
  scanSkillTextWithCounts,
  toStoredFindingCounts,
} from '#shared/utils/skills/findings'

export interface SkillFindingsRescan {
  counts: Record<string, number> | null
  isRescanned: boolean
}

/**
 * The counts to show for a stored version. Counts written by the current
 * rules are used as they are. Counts from an older rule set are not
 * comparable with today's, so the files are read one at a time and scanned
 * here in the browser; the result is shown, never written back. When any
 * file cannot be read, the stored counts stay.
 */
export async function rescanStoredFindingCounts(input: {
  stored: Record<string, number> | null
  listPaths: () => Promise<string[]>
  readText: (path: string) => Promise<string>
}): Promise<SkillFindingsRescan> {
  if (!isStoredFindingCountsStale(input.stored)) {
    return { counts: input.stored, isRescanned: false }
  }

  const typeCounts: Record<string, number> = {}
  const severityCounts: Record<string, number> = {}

  try {
    for (const path of await input.listPaths()) {
      const scan = scanSkillTextWithCounts(path, await input.readText(path))

      for (const [type, count] of Object.entries(scan.counts)) {
        typeCounts[type] = (typeCounts[type] ?? 0) + count
      }

      for (const [severity, count] of Object.entries(scan.severityCounts)) {
        severityCounts[severity] = (severityCounts[severity] ?? 0) + count
      }
    }
  } catch {
    return { counts: input.stored, isRescanned: false }
  }

  return {
    counts: toStoredFindingCounts(typeCounts, severityCounts),
    isRescanned: true,
  }
}
