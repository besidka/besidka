import { JEV_SKILL_SCREENING } from '#shared/utils/jev-policy'
import type { JevSkillQuestionId } from '#shared/utils/jev-policy'
import type {
  SkillFinding,
  SkillFindingSeverity,
  SkillFindingType,
} from '#shared/utils/skills/findings'

export interface SkillJevRange {
  path: string
  startLine: number
  endLine: number
}

export interface SkillJevMark extends SkillJevRange {
  question: JevSkillQuestionId
  rule: string
  severity: SkillFindingSeverity
  score: number
}

export const SKILL_JEV_COUNT_KEYS = {
  marked: 'jev:marked',
  unchecked: 'jev:unchecked',
  questionSet: 'jev:questionSet',
} as const

const JEV_COUNT_PREFIX = 'jev:'

export const SKILL_JEV_RULES: Readonly<Record<
  JevSkillQuestionId,
  { rule: string, type: SkillFindingType }
>> = {
  i2_attack: { rule: 'jev-attack', type: 'injection' },
  k1_send_out: { rule: 'jev-send-out', type: 'exfiltration' },
  k2_conceal: { rule: 'jev-conceal', type: 'concealment' },
  k3_secrets: { rule: 'jev-secrets', type: 'credential' },
  k4_run_remote: { rule: 'jev-run-remote', type: 'execution' },
}

export function createSkillJevMark(input: SkillJevRange & {
  question: JevSkillQuestionId
  score: number
}): SkillJevMark {
  return {
    path: input.path,
    startLine: input.startLine,
    endLine: input.endLine,
    question: input.question,
    rule: SKILL_JEV_RULES[input.question].rule,
    severity: JEV_SKILL_SCREENING.severity[input.question],
    score: Math.round(input.score * 100) / 100,
  }
}

export const SKILL_JEV_REASONS: Readonly<Record<string, string>> = {
  'jev-attack': 'tries to steer an assistant',
  'jev-send-out': 'asks to send data out',
  'jev-conceal': 'asks to hide what it does',
  'jev-secrets': 'asks for keys or secrets',
  'jev-run-remote': 'asks to download and run code',
}

export const SKILL_JEV_FALLBACK_REASON = 'worth a second look'

export function getSkillJevReason(rule: string): string {
  return SKILL_JEV_REASONS[rule] ?? SKILL_JEV_FALLBACK_REASON
}

export function describeSkillLineRange(range: {
  startLine: number
  endLine: number
}): string {
  return range.startLine === range.endLine
    ? `line ${range.startLine}`
    : `lines ${range.startLine} to ${range.endLine}`
}

function describeRange(range: SkillJevRange): string {
  return range.startLine === range.endLine
    ? `TypeSafe AI, line ${range.startLine}`
    : `TypeSafe AI, lines ${range.startLine} to ${range.endLine}`
}

/**
 * One finding per mark, on the first line of its range. The snippet is empty
 * because a mark stores no text: the review screen shows the lines it already
 * has.
 */
export function toSkillJevFindings(marks: SkillJevMark[]): SkillFinding[] {
  return marks.map((mark) => {
    return {
      type: SKILL_JEV_RULES[mark.question].type,
      rule: mark.rule,
      severity: mark.severity,
      path: mark.path,
      line: mark.startLine,
      snippet: '',
      detail: describeRange(mark),
      source: 'jev',
    }
  })
}

/**
 * Add-only merge: every rule finding comes back unchanged and in order, with
 * the Jev findings after them. A Jev finding is never merged into, never
 * replaces and never reorders a rule finding, whatever line or severity it
 * has, and a Jev result of any size cannot lower what the rules found.
 */
export function mergeSkillJevFindings(
  ruleFindings: SkillFinding[],
  jevFindings: SkillFinding[],
): SkillFinding[] {
  const seen = new Set<string>()
  const added = jevFindings.filter((finding) => {
    const key = `${finding.rule}\u0000${finding.path}\u0000${finding.line}`

    if (finding.source !== 'jev' || seen.has(key)) {
      return false
    }

    seen.add(key)

    return true
  })

  return [...ruleFindings, ...added]
}

export function toSkillJevFindingCounts(input: {
  marks: SkillJevMark[]
  unchecked: SkillJevRange[]
  questionSetVersion: number
}): Record<string, number> {
  return {
    [SKILL_JEV_COUNT_KEYS.marked]: input.marks.length,
    [SKILL_JEV_COUNT_KEYS.unchecked]: input.unchecked.length,
    [SKILL_JEV_COUNT_KEYS.questionSet]: input.questionSetVersion,
  }
}

export function withoutSkillJevFindingCounts(
  counts: Record<string, number> | null | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts ?? {}).filter(([key]) => {
      return !key.startsWith(JEV_COUNT_PREFIX)
    }),
  )
}
