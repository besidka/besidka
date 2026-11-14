import type {
  SkillFinding,
  SkillFindingType,
} from '#shared/utils/skills/findings'

const FINDING_LABELS: Record<SkillFindingType, [string, string]> = {
  'url': ['link', 'links'],
  'shell': ['command', 'commands'],
  'hidden-character': ['hidden character', 'hidden characters'],
  'long-line': ['very long line', 'very long lines'],
  'blank-run': ['run of blank lines', 'runs of blank lines'],
  'injection': ['instruction-like phrase', 'instruction-like phrases'],
  'secret': ['key or .env mention', 'key or .env mentions'],
}

const FINDING_MARKERS: Record<SkillFindingType, string> = {
  'url': 'Link',
  'shell': 'Command',
  'hidden-character': 'Hidden character',
  'long-line': 'Long line',
  'blank-run': 'Blank lines',
  'injection': 'Instruction-like',
  'secret': 'Key or .env',
}

export function getFindingMarker(type: SkillFindingType): string {
  return FINDING_MARKERS[type]
}

/**
 * "3 links, 1 command" for a map of finding counts, in the order of the
 * finding types. Used on the review screens as a neutral tally: a count is
 * something to look at, never a verdict.
 */
export function describeFindingCounts(
  counts: Record<string, number> | null | undefined,
): string {
  if (!counts) {
    return ''
  }

  return (Object.keys(FINDING_LABELS) as SkillFindingType[])
    .filter(type => (counts[type] ?? 0) > 0)
    .map((type) => {
      const count = counts[type]!
      const [singular, plural] = FINDING_LABELS[type]

      return `${count} ${count === 1 ? singular : plural}`
    })
    .join(', ')
}

export function groupFindingsByLine(
  findings: SkillFinding[],
  path: string,
): Map<number, SkillFinding[]> {
  const lines = new Map<number, SkillFinding[]>()

  for (const finding of findings) {
    if (finding.path !== path) {
      continue
    }

    lines.set(finding.line, [...lines.get(finding.line) ?? [], finding])
  }

  return lines
}
