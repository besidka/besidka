import {
  SKILL_FINDING_CATALOG_DETAIL,
  SKILL_FINDING_SEVERITIES,
  SKILL_FINDING_QUOTED_DETAIL,
  getSkillFindingCallout,
  getSkillFindingExplanation,
  readStoredFindingCounts,
} from '#shared/utils/skills/findings'
import type {
  SkillFinding,
  SkillFindingSeverity,
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
  'execution': ['line that runs code', 'lines that run code'],
  'exfiltration': ['request to send data out', 'requests to send data out'],
  'concealment': ['request to keep something from you', 'requests to keep something from you'],
  'role': ['role or authority claim', 'role or authority claims'],
  'credential': ['credential mention', 'credential mentions'],
  'encoded': ['encoded block', 'encoded blocks'],
  'frontmatter': ['setting to check', 'settings to check'],
  'file': ['file to check', 'files to check'],
}

const FINDING_MARKERS: Record<SkillFindingType, string> = {
  'url': 'Link',
  'shell': 'Command',
  'hidden-character': 'Hidden character',
  'long-line': 'Long line',
  'blank-run': 'Blank lines',
  'injection': 'Instruction-like',
  'secret': 'Key or .env',
  'execution': 'Runs code',
  'exfiltration': 'Sends data out',
  'concealment': 'Keeps from you',
  'role': 'Role claim',
  'credential': 'Credential',
  'encoded': 'Encoded',
  'frontmatter': 'Setting',
  'file': 'File',
}

const HIGHLIGHT_CATEGORIES: Record<SkillFindingType, string> = {
  'url': 'a link to an unusual address',
  'shell': 'a command',
  'hidden-character': 'hidden text',
  'long-line': 'a very long line',
  'blank-run': 'blank lines',
  'injection': 'instruction-like text',
  'secret': 'a key or secret',
  'execution': 'code that runs in Claude Code',
  'exfiltration': 'a request to send data out',
  'concealment': 'a request to hide actions from you',
  'role': 'a role or authority claim',
  'credential': 'a credential',
  'encoded': 'encoded text',
  'frontmatter': 'a setting that asks for access',
  'file': 'a file to check',
}

export const FINDING_SEVERITY_GROUPS: ReadonlyArray<{
  severity: SkillFindingSeverity
  title: string
  isOpenByDefault: boolean
}> = [
  { severity: 'high', title: 'Look closely', isOpenByDefault: true },
  { severity: 'medium', title: 'Worth a look', isOpenByDefault: true },
  { severity: 'low', title: 'For your information', isOpenByDefault: false },
]

const SEVERITY_TALLY_LABELS: Record<SkillFindingSeverity, string> = {
  high: 'to look closely at',
  medium: 'worth a look',
  low: 'for your information',
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

export function groupFindingsBySeverity(
  findings: SkillFinding[],
): Array<{
  severity: SkillFindingSeverity
  title: string
  isOpenByDefault: boolean
  findings: SkillFinding[]
}> {
  return FINDING_SEVERITY_GROUPS
    .map((group) => {
      return {
        ...group,
        findings: findings.filter((finding) => {
          return finding.severity === group.severity
        }),
      }
    })
    .filter((group) => {
      return group.findings.length > 0
    })
}

/**
 * "2 to look closely at, 5 worth a look, 31 for your information" for a map
 * of stored or scanned counts, or an empty string when the counts carry no
 * severities (counts stored before the rules had them).
 */
export function describeSeverityCounts(
  counts: Record<string, number> | null | undefined,
): string {
  const { severityCounts } = readStoredFindingCounts(counts)

  return SKILL_FINDING_SEVERITIES
    .filter(severity => (severityCounts[severity] ?? 0) > 0)
    .map((severity) => {
      return `${severityCounts[severity]} ${SEVERITY_TALLY_LABELS[severity]}`
    })
    .join(', ')
}

/**
 * "1 to look closely at, 4 for your information (1 command, 4 links)" for
 * counts that carry severities, and the plain type tally for counts that do
 * not.
 */
export function describeFindingSummary(
  counts: Record<string, number> | null | undefined,
): string {
  const severities = describeSeverityCounts(counts)
  const types = describeFindingCounts(counts)

  return severities && types ? `${severities} (${types})` : types || severities
}

export function describeQuotedMention(finding: SkillFinding): string {
  return finding.detail === SKILL_FINDING_QUOTED_DETAIL
    ? `(${SKILL_FINDING_QUOTED_DETAIL})`
    : ''
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

/**
 * The plain explanation of a finding and, when it adds something, the detail
 * the rule found (a host, a decoded text). A quoted mention and the "in every
 * message" detail are shown on their own, not as detail.
 */
export function describeFinding(finding: SkillFinding): {
  explanation: string
  detail: string
  callout: string | null
} {
  const explanation = getSkillFindingExplanation(finding.rule) ?? ''
  const hasPlainDetail = finding.detail
    && finding.detail !== SKILL_FINDING_QUOTED_DETAIL
    && !finding.detail.includes(SKILL_FINDING_CATALOG_DETAIL)

  return {
    explanation: explanation || finding.detail || '',
    detail: hasPlainDetail && explanation ? finding.detail! : '',
    callout: getSkillFindingCallout(finding),
  }
}

/**
 * "code that runs in Claude Code, a request to hide actions from you" for the
 * "Look closely" findings, each kind once, in order of appearance.
 */
export function describeHighlightCategories(
  findings: SkillFinding[],
): string {
  const categories = findings
    .filter(finding => finding.severity === 'high')
    .map(finding => HIGHLIGHT_CATEGORIES[finding.type])

  return [...new Set(categories)].join(', ')
}

/**
 * The second tick of the install and accept screens: "I read the 3
 * highlights marked Look closely (code that runs in Claude Code)". Empty when
 * there is nothing marked Look closely.
 */
export function describeHighlightTick(
  count: number,
  findings: SkillFinding[],
): string {
  if (count <= 0) {
    return ''
  }

  const categories = describeHighlightCategories(findings)
  const subject = count === 1
    ? 'the highlight'
    : `the ${count} highlights`

  return categories
    ? `I read ${subject} marked Look closely (${categories})`
    : `I read ${subject} marked Look closely`
}
