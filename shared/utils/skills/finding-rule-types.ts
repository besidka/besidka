import type {
  SkillFindingSeverity,
  SkillFindingType,
} from '#shared/utils/skills/findings'

export type QuoteMode = 'quotes' | 'inline-code'

export interface RuleRefinement {
  severity?: SkillFindingSeverity
  detail?: string | null
}

/**
 * One row of the rule table. `pattern` runs on a line whose whitespace is
 * collapsed to one space. `quote` marks a rule whose match can be a mention
 * (see `isQuotedMention`). `refine` can raise or lower the severity of one
 * match, or return null to drop it. `catalogRaise` rules go up one level when
 * the match sits in the description, argument hint or metadata of SKILL.md,
 * which reach every send while a skill is on Auto. `supersededBy` names a
 * stronger rule on the same text; the weaker one is dropped when the stronger
 * one matches the line. `maskMatch` hides the matched characters in every
 * snippet of the line.
 */
export interface TextRule {
  rule: string
  type: SkillFindingType
  severity: SkillFindingSeverity
  detail: string | null
  explanation: string
  pattern: RegExp
  quote?: QuoteMode
  accept?: (match: RegExpExecArray) => boolean
  refine?: (match: RegExpExecArray, text: string) => RuleRefinement | null
  catalogRaise?: boolean
  supersededBy?: string
  maskMatch?: boolean
}
