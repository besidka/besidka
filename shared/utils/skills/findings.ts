import {
  SKILL_FINDINGS_MAX_PER_FILE,
  SKILL_FINDING_BLANK_RUN,
  SKILL_FINDING_LONG_LINE,
} from '#shared/utils/skills-policy'
import { EXTRA_FINDING_EXPLANATIONS } from '#shared/utils/skills/finding-explanations'
import type {
  QuoteMode,
  RuleRefinement,
  TextRule,
} from '#shared/utils/skills/finding-rule-types'
import { BASE_TEXT_RULES } from '#shared/utils/skills/finding-rules-base'
import { EXECUTION_TEXT_RULES } from '#shared/utils/skills/finding-rules-execution'
import {
  EMAIL_PATTERN,
  HARDCODED_SECRET_MASK_PATTERN,
  INTENT_TEXT_RULES,
  SENSITIVE_OBJECT_PATTERN,
  SEND_VERB_PATTERN,
} from '#shared/utils/skills/finding-rules-intent'
import { scanSkillFrontmatter } from '#shared/utils/skills/frontmatter-findings'
import {
  HIDDEN_CHARACTER_PATTERN,
  TAG_CHARACTER_RUN_PATTERN,
  decodeTagCharacters,
  isEmojiTagSequence,
  isTagBlockCharacter,
  showHiddenCharacters,
} from '#shared/utils/skills/hidden-characters'
import {
  findConfusableIndex,
  findMixedScriptWord,
  hasNonAscii,
  toConfusableSkeleton,
} from '#shared/utils/skills/lookalikes'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import {
  classifySkillUrl,
  findRiskyHost,
} from '#shared/utils/skills/url-hosts'

export type { QuoteMode } from '#shared/utils/skills/finding-rule-types'

export {
  formatHiddenCharacter,
  showHiddenCharacters,
} from '#shared/utils/skills/hidden-characters'

export const SKILL_FINDING_RULES_VERSION = 3

export const SKILL_FINDING_TYPES = [
  'url',
  'shell',
  'hidden-character',
  'long-line',
  'blank-run',
  'injection',
  'secret',
  'execution',
  'exfiltration',
  'concealment',
  'role',
  'credential',
  'encoded',
  'frontmatter',
  'file',
] as const

export type SkillFindingType = typeof SKILL_FINDING_TYPES[number]

export const SKILL_FINDING_SEVERITIES = ['high', 'medium', 'low'] as const

export type SkillFindingSeverity = typeof SKILL_FINDING_SEVERITIES[number]

export type SkillFindingSource = 'rules' | 'jev'

export interface SkillFinding {
  type: SkillFindingType
  rule: string
  severity: SkillFindingSeverity
  path: string
  line: number
  snippet: string
  detail: string | null
  source: SkillFindingSource
}

export interface SkillTextScan {
  findings: SkillFinding[]
  counts: Record<string, number>
  severityCounts: Record<string, number>
}

export interface SkillScanContext {
  inCodeFence: boolean
  inDynamicFence: boolean
  inFrontmatter: boolean
  frontmatterKey: string | null
}

export interface SkillScanState {
  fence: { marker: string, length: number, dynamic: boolean } | null
  dynamicBlocks: number
  dynamicLines: number
  frontmatterEnd: number
  frontmatterKey: string | null
}

export const SKILL_FINDING_QUOTED_DETAIL = 'quoted, probably an example'

export const SKILL_FINDING_CATALOG_DETAIL
  = 'sent with every message while the skill is on Auto'

export const SKILL_FINDING_CATALOG_CALLOUT
  = 'This text is in every message while the skill is on Auto.'

const SEVERITY_RANK: Record<SkillFindingSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}
const RULES_VERSION_KEY = 'rulesVersion'
const JEV_COUNT_PREFIX = 'jev:'
const SNIPPET_MAX_CHARACTERS = 120
const SNIPPET_LEAD_CHARACTERS = 40
const WINDOW_CHARACTERS = 5000
const WINDOW_OVERLAP_CHARACTERS = 500
const WINDOW_STEP_CHARACTERS = WINDOW_CHARACTERS - WINDOW_OVERLAP_CHARACTERS
const QUOTE_LOOKBEHIND_CHARACTERS = 3
const QUOTE_LOOKAHEAD_CHARACTERS = 24
const CODE_SPAN_REACH_CHARACTERS = 300
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const WHITESPACE_RUN_PATTERN = /\s+/g
const SKILL_FINDING_PADDING_RUN = 200
const MAX_DECODES_PER_LINE = 8
const MAX_DECODES_PER_SCAN = 200
const ENCODED_DECODE_MAX_CHARACTERS = 4096
const DECODED_HIT_MAX_CHARACTERS = 60
const PRINTABLE_RATIO = 0.85
const BASE64_RUN_PATTERN = /[A-Za-z0-9+/]{24,}={0,2}/g
const BASE64_LONG_RUN_CHARACTERS = 120
const ESCAPE_RUN_PATTERN
  = /(?:\\x[0-9a-f]{2}){20,}|(?:%[0-9a-f]{2}){20,}|(?:\\u[0-9a-f]{4}){10,}/gi
const ESCAPE_UNIT_PATTERN
  = /\\x([0-9a-f]{2})|%([0-9a-f]{2})|\\u([0-9a-f]{4})/gi
const TRAILING_PADDING_PATTERN = /=+$/
const READABLE_TEXT_PATTERN = /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u
const DATA_IMAGE_PREFIX_PATTERN = /data:image\/[a-z0-9.+-]{1,20};base64,$/i
const IMAGE_REFERENCE_PATTERN = /!\[([^\]]{0,200})\](?:\[([^\]]{0,50})\])?/g
const REFERENCE_DEFINITION_PATTERN
  = /^ {0,3}\[([^\]]{1,50})\]: ?<?(https?:\/\/[^\s>]{1,500})/i
const REFERENCE_QUERY_PATTERN = /[?&][^\s=&#]{1,100}=/
const CATALOG_KEYS: ReadonlySet<string> = new Set([
  'description',
  'argument-hint',
  'metadata',
])
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'txt'])
const URL_TEST_PATTERN = /\bhttps?:\/\//i
const FRONTMATTER_FENCE_PATTERN = /^---[ \t]*$/
const FRONTMATTER_END_PATTERN = /^(?:---|\.\.\.)[ \t]*$/
const FRONTMATTER_KEY_PATTERN = /^([A-Za-z0-9_-]+) ?:/
const CODE_FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const CODE_FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const BYTE_ORDER_MARK = '﻿'
const CLOSING_QUOTES: Record<string, string> = {
  '"': '"',
  '\'': '\'',
  '`': '`',
  '“': '”',
  '‘': '’',
  '«': '»',
}

interface CompiledTextRule extends TextRule {
  scanner: RegExp
}

interface RuleMatch {
  index: number
  length: number
  quoted: boolean
  refinement: RuleRefinement | null
}

/**
 * Text rules run on a line whose whitespace runs are collapsed to one space,
 * so none of them needs `\s+` or `\s*`, and each has a single, unambiguous
 * way to match: nothing can backtrack quadratically on an untrusted line.
 * Every rule has an id that never changes; later rule sets add rows to the
 * tables in the `finding-rules-*` files.
 */
export const SKILL_TEXT_RULES: ReadonlyArray<TextRule> = [
  ...BASE_TEXT_RULES,
  ...EXECUTION_TEXT_RULES,
  ...INTENT_TEXT_RULES,
]

const COMPILED_TEXT_RULES: ReadonlyArray<CompiledTextRule>
  = SKILL_TEXT_RULES.map(
    (rule) => {
      return {
        ...rule,
        scanner: new RegExp(
          rule.pattern.source,
          rule.pattern.flags.includes('g')
            ? rule.pattern.flags
            : `${rule.pattern.flags}g`,
        ),
      }
    },
  )

const DECODED_TEXT_RULES: ReadonlyArray<CompiledTextRule>
  = COMPILED_TEXT_RULES.filter((rule) => {
    return rule.severity === 'high' && !rule.refine
  })

const EXPLANATIONS: ReadonlyMap<string, string> = new Map([
  ...SKILL_TEXT_RULES.map((rule): [string, string] => {
    return [rule.rule, rule.explanation]
  }),
  ...Object.entries(EXTRA_FINDING_EXPLANATIONS),
])

/**
 * The plain explanation of a rule for the review screens, or null for a rule
 * id this build does not know. Besidka never runs what a rule describes; the
 * texts say what Claude Code would do.
 */
export function getSkillFindingExplanation(rule: string): string | null {
  return EXPLANATIONS.get(rule) ?? null
}

/**
 * The callout for a finding in the description, argument hint or metadata of
 * SKILL.md, which reach every send while the skill is on Auto.
 */
export function getSkillFindingCallout(
  finding: Pick<SkillFinding, 'detail'>,
): string | null {
  return finding.detail?.includes(SKILL_FINDING_CATALOG_DETAIL)
    ? SKILL_FINDING_CATALOG_CALLOUT
    : null
}

export function isSkillFindingSeverity(
  value: string,
): value is SkillFindingSeverity {
  return (SKILL_FINDING_SEVERITIES as readonly string[]).includes(value)
}

export function compareSkillFindingSeverity(
  left: SkillFindingSeverity,
  right: SkillFindingSeverity,
): number {
  return SEVERITY_RANK[left] - SEVERITY_RANK[right]
}

function toSnippet(text: string): string {
  const visible = showHiddenCharacters(text.trim())

  return visible.length > SNIPPET_MAX_CHARACTERS
    ? `${visible.slice(0, SNIPPET_MAX_CHARACTERS)}...`
    : visible
}

/**
 * The snippet starts at the line start while the match is near it, and
 * otherwise a few characters before the match, so a payload far along a long
 * line is the part that shows.
 */
function toSnippetAround(text: string, index: number): string {
  if (index <= SNIPPET_MAX_CHARACTERS - SNIPPET_LEAD_CHARACTERS) {
    return toSnippet(text.slice(0, SNIPPET_MAX_CHARACTERS + 1))
  }

  const start = index - SNIPPET_LEAD_CHARACTERS

  return `...${toSnippet(
    text.slice(start, start + SNIPPET_MAX_CHARACTERS + 1),
  )}`
}

function isValidIpv4(address: string): boolean {
  return address.split('.').every((octet) => {
    return Number(octet) <= 255
  })
}

function isQuotedByQuotes(
  text: string,
  index: number,
  length: number,
): boolean {
  const lookbehindStart = Math.max(0, index - QUOTE_LOOKBEHIND_CHARACTERS)
  let openingIndex = -1

  for (let position = index - 1; position >= lookbehindStart; position--) {
    if (text[position]! in CLOSING_QUOTES) {
      openingIndex = position

      break
    }
  }

  if (openingIndex === -1) {
    return false
  }

  const closing = CLOSING_QUOTES[text[openingIndex]!]!
  const after = text.slice(
    index + length,
    index + length + QUOTE_LOOKAHEAD_CHARACTERS,
  )

  if (!after.includes(closing)) {
    return false
  }

  let beforeQuote = openingIndex - 1

  while (beforeQuote >= 0 && text[beforeQuote] === ' ') {
    beforeQuote--
  }

  return text[beforeQuote] !== ':' && text[beforeQuote] !== '='
}

function isInsideInlineCode(
  text: string,
  index: number,
  length: number,
): boolean {
  const before = text.slice(
    Math.max(0, index - CODE_SPAN_REACH_CHARACTERS),
    index,
  )
  const after = text.slice(
    index + length,
    index + length + CODE_SPAN_REACH_CHARACTERS,
  )
  let backticksBefore = 0

  for (const character of before) {
    if (character === '`') {
      backticksBefore++
    }
  }

  return backticksBefore % 2 === 1 && after.includes('`')
}

/**
 * Whether a match reads as a mention rather than an instruction. `quotes`
 * wants the match inside quotes or a backtick span that closes within about
 * 24 characters; a quoted value after `:` or `=` never counts. `inline-code`
 * wants the match inside an inline code span on a line without a URL. A
 * match inside a ```! block is never a mention.
 */
export function isQuotedMention(input: {
  text: string
  index: number
  length: number
  mode: QuoteMode
  inDynamicFence?: boolean
  lineHasUrl?: boolean
}): boolean {
  if (input.inDynamicFence) {
    return false
  }

  if (input.mode === 'inline-code') {
    return !(input.lineHasUrl ?? URL_TEST_PATTERN.test(input.text))
      && isInsideInlineCode(input.text, input.index, input.length)
  }

  return isQuotedByQuotes(input.text, input.index, input.length)
}

export function createSkillScanState(lines: string[]): SkillScanState {
  const firstLine = lines[0]?.replace(BYTE_ORDER_MARK, '').replace(/\r$/, '')
  let frontmatterEnd = -1

  if (firstLine !== undefined && FRONTMATTER_FENCE_PATTERN.test(firstLine)) {
    for (let index = 1; index < lines.length; index++) {
      if (FRONTMATTER_END_PATTERN.test(lines[index]!.replace(/\r$/, ''))) {
        frontmatterEnd = index

        break
      }
    }
  }

  return {
    fence: null,
    dynamicBlocks: 0,
    dynamicLines: 0,
    frontmatterEnd,
    frontmatterKey: null,
  }
}

/**
 * Moves the multi-line state past one line and says where that line sits:
 * in the frontmatter (and under which top-level key), in a normal code fence,
 * or in a ```! block (Claude Code runs those before the skill loads). The
 * context only describes a finding; it never hides one. `index` is the
 * zero-based line index.
 */
export function advanceSkillScanState(
  state: SkillScanState,
  rawLine: string,
  index: number,
): SkillScanContext {
  const line = rawLine.replace(/\r$/, '')

  if (state.frontmatterEnd !== -1 && index <= state.frontmatterEnd) {
    if (index > 0 && index < state.frontmatterEnd) {
      const key = FRONTMATTER_KEY_PATTERN.exec(line)

      if (key) {
        state.frontmatterKey = key[1]!
      }
    }

    return {
      inCodeFence: false,
      inDynamicFence: false,
      inFrontmatter: true,
      frontmatterKey: index > 0 && index < state.frontmatterEnd
        ? state.frontmatterKey
        : null,
    }
  }

  const fence = state.fence

  if (fence) {
    const closing = CODE_FENCE_CLOSE_PATTERN.exec(line)
    const isClosing = closing !== null
      && closing[1]![0] === fence.marker
      && closing[1]!.length >= fence.length

    if (isClosing) {
      state.fence = null
    } else if (fence.dynamic) {
      state.dynamicLines++
    }

    return {
      inCodeFence: true,
      inDynamicFence: fence.dynamic,
      inFrontmatter: false,
      frontmatterKey: null,
    }
  }

  const opening = CODE_FENCE_OPEN_PATTERN.exec(line)

  if (opening && !(opening[1]![0] === '`' && opening[2]!.includes('`'))) {
    const dynamic = opening[2]!.startsWith('!')

    state.fence = {
      marker: opening[1]![0]!,
      length: opening[1]!.length,
      dynamic,
    }

    if (dynamic) {
      state.dynamicBlocks++
    }

    return {
      inCodeFence: true,
      inDynamicFence: dynamic,
      inFrontmatter: false,
      frontmatterKey: null,
    }
  }

  return {
    inCodeFence: false,
    inDynamicFence: false,
    inFrontmatter: false,
    frontmatterKey: null,
  }
}

interface SeverityOrderEntry {
  finding: SkillFinding
  sequence: number
}

function compareEntries(
  left: SeverityOrderEntry,
  right: SeverityOrderEntry,
): number {
  return compareSkillFindingSeverity(
    left.finding.severity,
    right.finding.severity,
  ) || left.sequence - right.sequence
}

/**
 * The most severe findings first (severity, then position), at most `max`,
 * plus the first of the most severe of any type that would otherwise vanish,
 * so a file full of links can never hide one command.
 */
function selectSeverityFirst(
  entries: SeverityOrderEntry[],
  max: number,
): SkillFinding[] {
  const sorted = [...entries].sort(compareEntries)
  const kept = sorted.slice(0, max)
  const seenTypes = new Set(kept.map((entry) => {
    return entry.finding.type
  }))

  for (const entry of sorted.slice(max)) {
    if (!seenTypes.has(entry.finding.type)) {
      seenTypes.add(entry.finding.type)
      kept.push(entry)
    }
  }

  return kept.sort(compareEntries).map((entry) => {
    return entry.finding
  })
}

/**
 * Collects findings while counting every one of them. Findings are held in
 * one bucket per severity, each bounded, so memory stays small on a file of
 * a million links; the stored list is picked once at the end.
 */
class FindingCollector {
  readonly counts: Record<string, number> = {}

  readonly severityCounts: Record<string, number> = {}

  private readonly buckets: Record<SkillFindingSeverity, SeverityOrderEntry[]>
    = { high: [], medium: [], low: [] }

  private readonly representatives = new Map<string, SeverityOrderEntry>()

  private sequence = 0

  constructor(private readonly maxStored: number) {}

  add(finding: SkillFinding): void {
    this.counts[finding.type] = (this.counts[finding.type] ?? 0) + 1
    this.severityCounts[finding.severity]
      = (this.severityCounts[finding.severity] ?? 0) + 1

    const entry = { finding, sequence: this.sequence++ }
    const bucket = this.buckets[finding.severity]

    if (bucket.length < this.maxStored) {
      bucket.push(entry)
    }

    const representative = this.representatives.get(finding.type)

    if (
      !representative
      || compareSkillFindingSeverity(
        finding.severity,
        representative.finding.severity,
      ) < 0
    ) {
      this.representatives.set(finding.type, entry)
    }
  }

  get findings(): SkillFinding[] {
    const entries = new Map<number, SeverityOrderEntry>()

    for (const entry of [
      ...this.buckets.high,
      ...this.buckets.medium,
      ...this.buckets.low,
      ...this.representatives.values(),
    ]) {
      entries.set(entry.sequence, entry)
    }

    return selectSeverityFirst([...entries.values()], this.maxStored)
  }
}

interface ScanBudget {
  longDecodesRemaining: number
  shortDecodesRemaining: number
}

interface ExtraFinding {
  type: SkillFindingType
  rule: string
  severity: SkillFindingSeverity
  index: number
  detail: string | null
}

interface LineScanContext {
  collapsed: string
  maskedCollapsed: string
  context: SkillScanContext
  path: string
  lineNumber: number
  hasUrl: boolean | null
  isCatalog: boolean
  budget: ScanBudget
  references: ReadonlyMap<string, string>
}

interface ScanFileContext {
  path: string
  isSkillMd: boolean
  isDocument: boolean
  budget: ScanBudget
  references: ReadonlyMap<string, string>
}

function raiseSeverity(
  severity: SkillFindingSeverity,
): SkillFindingSeverity {
  return severity === 'low' ? 'medium' : 'high'
}

function describeWithContext(
  detail: string | null,
  context: SkillScanContext,
  isCatalogText: boolean,
): string | null {
  const note = context.inDynamicFence
    ? 'in a ```! block'
    : context.inCodeFence
      ? 'in a code block'
      : null

  return [
    detail,
    note,
    isCatalogText ? SKILL_FINDING_CATALOG_DETAIL : null,
  ].filter(Boolean).join(', ') || null
}

function findRuleMatch(
  rule: CompiledTextRule,
  window: string,
  windowStart: number,
  line: LineScanContext,
): RuleMatch | null {
  const scanner = rule.scanner
  let firstQuoted: RuleMatch | null = null

  scanner.lastIndex = 0

  for (
    let match = scanner.exec(window);
    match !== null;
    match = scanner.exec(window)
  ) {
    if (match[0].length === 0) {
      scanner.lastIndex++

      continue
    }

    if (rule.accept && !rule.accept(match)) {
      continue
    }

    const refinement = rule.refine ? rule.refine(match, window) : null

    if (rule.refine && !refinement) {
      continue
    }

    const index = windowStart + match.index

    if (!rule.quote) {
      return { index, length: match[0].length, quoted: false, refinement }
    }

    if (rule.quote === 'inline-code' && line.hasUrl === null) {
      line.hasUrl = URL_TEST_PATTERN.test(line.collapsed)
    }

    const quoted = isQuotedMention({
      text: line.collapsed,
      index,
      length: match[0].length,
      mode: rule.quote,
      inDynamicFence: line.context.inDynamicFence,
      lineHasUrl: line.hasUrl ?? undefined,
    })

    if (!quoted) {
      return { index, length: match[0].length, quoted: false, refinement }
    }

    firstQuoted ??= {
      index,
      length: match[0].length,
      quoted: true,
      refinement,
    }
  }

  return firstQuoted
}

function toPrintableText(binary: string): string | null {
  let printable = 0

  for (let position = 0; position < binary.length; position++) {
    const code = binary.charCodeAt(position)

    if ((code >= 0x20 && code <= 0x7E) || code === 9 || code === 10
      || code === 13) {
      printable++
    }
  }

  return binary.length > 0 && printable / binary.length >= PRINTABLE_RATIO
    ? binary
    : null
}

function decodeBase64Run(run: string): string | null {
  const trimmed = run.slice(0, ENCODED_DECODE_MAX_CHARACTERS).replace(
    TRAILING_PADDING_PATTERN,
    '',
  )
  const usable = trimmed.length % 4 === 1
    ? trimmed.slice(0, -1)
    : `${trimmed}${'='.repeat((4 - (trimmed.length % 4)) % 4)}`

  if (usable.length < 4) {
    return null
  }

  try {
    return toPrintableText(atob(usable))
  } catch {
    return null
  }
}

function decodeEscapedRun(run: string): string | null {
  const decoded = run.slice(0, ENCODED_DECODE_MAX_CHARACTERS).replace(
    ESCAPE_UNIT_PATTERN,
    (
      _unit,
      hex: string | undefined,
      percent: string | undefined,
      wide: string | undefined,
    ) => {
      return String.fromCharCode(
        Number.parseInt(hex ?? percent ?? wide ?? '0', 16),
      )
    },
  )

  return toPrintableText(decoded)
}

function decodeReadablePercentText(run: string): string | null {
  try {
    const decoded = decodeURIComponent(
      run.slice(0, ENCODED_DECODE_MAX_CHARACTERS),
    )

    return READABLE_TEXT_PATTERN.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

function findDecodedHit(decoded: string): string | null {
  const collapsed = decoded.replace(WHITESPACE_RUN_PATTERN, ' ')

  for (const rule of DECODED_TEXT_RULES) {
    const match = rule.pattern.exec(collapsed)

    if (match && (!rule.accept || rule.accept(match))) {
      return match[0].trim().slice(0, DECODED_HIT_MAX_CHARACTERS)
    }
  }

  return null
}

function evaluateEncodedRun(input: {
  kind: 'base64' | 'hex'
  run: string
  before: string
  index: number
  line: LineScanContext
  decodesInLine: number
}): ExtraFinding | null {
  const rule = input.kind === 'base64' ? 'base64-run' : 'hex-run'
  const base = { type: 'encoded' as const, rule, index: input.index }
  const isShortRun = input.kind === 'base64'
    && input.run.length < BASE64_LONG_RUN_CHARACTERS
  const isDataImage = input.kind === 'base64'
    && DATA_IMAGE_PREFIX_PATTERN.test(input.before)

  if (isDataImage) {
    return isShortRun
      ? null
      : { ...base, severity: 'low', detail: 'embedded image data' }
  }

  const budget = input.line.budget
  const hasBudget = isShortRun
    ? budget.shortDecodesRemaining > 0
    : budget.longDecodesRemaining > 0

  if (hasBudget && input.decodesInLine < MAX_DECODES_PER_LINE) {
    if (isShortRun) {
      budget.shortDecodesRemaining--
    } else {
      budget.longDecodesRemaining--
    }

    const isPercentRun = input.kind === 'hex' && input.run.startsWith('%')
    const readable = isPercentRun ? decodeReadablePercentText(input.run) : null
    const decoded = input.kind === 'base64'
      ? decodeBase64Run(input.run)
      : readable ?? decodeEscapedRun(input.run)
    const hit = decoded === null ? null : findDecodedHit(decoded)

    if (hit !== null) {
      return {
        ...base,
        severity: 'high',
        detail: `decoded text contains: ${hit}`,
      }
    }

    if (readable !== null) {
      return {
        ...base,
        severity: 'low',
        detail: 'percent-encoded text',
      }
    }
  }

  if (isShortRun) {
    return null
  }

  return {
    ...base,
    severity: 'medium',
    detail: input.kind === 'base64'
      ? `${input.run.length} characters of Base64 text`
      : `${input.run.length} escaped characters`,
  }
}

function keepStronger(
  extras: Map<string, ExtraFinding>,
  extra: ExtraFinding,
): void {
  const known = extras.get(extra.rule)

  if (
    !known
    || compareSkillFindingSeverity(extra.severity, known.severity) < 0
  ) {
    extras.set(extra.rule, extra)
  }
}

function findPaddingRun(line: string): number {
  let runStart = -1

  for (let position = 0; position < line.length; position++) {
    const code = line.charCodeAt(position)

    if (code === 32 || code === 9) {
      if (runStart === -1) {
        runStart = position
      }

      continue
    }

    if (runStart > 0 && position - runStart >= SKILL_FINDING_PADDING_RUN) {
      return runStart
    }

    runStart = -1
  }

  return -1
}

function findHiddenCharacters(line: string): { first: number, count: number } {
  let first = -1
  let count = 0

  for (const match of line.matchAll(HIDDEN_CHARACTER_PATTERN)) {
    if (isTagBlockCharacter(match[0])) {
      continue
    }

    count++

    if (first === -1) {
      first = match.index
    }
  }

  return { first, count }
}

function findTagText(line: string): { index: number, text: string } | null {
  for (const match of line.matchAll(TAG_CHARACTER_RUN_PATTERN)) {
    if (isEmojiTagSequence(
      line.slice(Math.max(0, match.index - 2), match.index),
      match[0],
    )) {
      continue
    }

    return { index: match.index, text: decodeTagCharacters(match[0]) }
  }

  return null
}

function readHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return null
  }
}

function maskSecret(secret: string): string {
  return `${secret.slice(0, 4)}${'•'.repeat(Math.max(0, secret.length - 4))}`
}

function maskSecrets(text: string): string {
  return text.replace(HARDCODED_SECRET_MASK_PATTERN, maskSecret)
}

function scanWindowForExfiltration(
  window: string,
  windowStart: number,
  urls: string[],
  extras: Map<string, ExtraFinding>,
): void {
  const verb = SEND_VERB_PATTERN.exec(window)

  if (!verb || !SENSITIVE_OBJECT_PATTERN.test(window)) {
    return
  }

  const riskyHost = urls.map((url) => {
    return findRiskyHost(url)
  }).find(Boolean)
  const hasDestination = urls.length > 0
    || (window.includes('@') && EMAIL_PATTERN.test(window))

  if (!hasDestination) {
    return
  }

  keepStronger(extras, {
    type: 'exfiltration',
    rule: 'exfiltration-send',
    severity: riskyHost ? 'high' : 'medium',
    index: windowStart + verb.index,
    detail: riskyHost ? `sends to a ${riskyHost.kind}` : 'sends to an address',
  })
}

function scanLine(
  file: ScanFileContext,
  lineNumber: number,
  line: string,
  context: SkillScanContext,
  collector: FindingCollector,
): void {
  const path = file.path
  const collapsed = line.replace(WHITESPACE_RUN_PATTERN, ' ')
  const maskedCollapsed = maskSecrets(collapsed)
  const lineContext: LineScanContext = {
    collapsed,
    maskedCollapsed,
    context,
    path,
    lineNumber,
    hasUrl: null,
    isCatalog: file.isSkillMd
      && context.inFrontmatter
      && context.frontmatterKey !== null
      && CATALOG_KEYS.has(context.frontmatterKey),
    budget: file.budget,
    references: file.references,
  }
  const add = (input: {
    type: SkillFindingType
    rule: string
    severity: SkillFindingSeverity
    snippet: string
    detail?: string | null
    isCatalogText?: boolean
  }) => {
    collector.add({
      type: input.type,
      rule: input.rule,
      severity: input.severity,
      path,
      line: lineNumber,
      snippet: input.snippet,
      detail: describeWithContext(
        input.detail ?? null,
        context,
        input.isCatalogText ?? false,
      ),
      source: 'rules',
    })
  }

  if (line.length > SKILL_FINDING_LONG_LINE) {
    add({
      type: 'long-line',
      rule: 'long-line',
      severity: 'low',
      snippet: toSnippet(maskedCollapsed.slice(0, SNIPPET_MAX_CHARACTERS + 1)),
      detail: `${line.length} characters`,
    })
  }

  const paddingIndex = findPaddingRun(line)

  if (paddingIndex !== -1) {
    add({
      type: 'long-line',
      rule: 'padding-spaces',
      severity: 'medium',
      snippet: toSnippetAround(
        maskedCollapsed,
        line.slice(0, paddingIndex).replace(WHITESPACE_RUN_PATTERN, ' ').length,
      ),
      detail: 'a long run of spaces inside the line',
    })
  }

  const hidden = findHiddenCharacters(line)

  if (hidden.first !== -1) {
    add({
      type: 'hidden-character',
      rule: 'hidden-character',
      severity: 'medium',
      snippet: toSnippetAround(maskSecrets(line), hidden.first),
      detail: `${hidden.count} hidden`,
    })
  }

  const tagText = findTagText(line)

  if (tagText) {
    add({
      type: 'hidden-character',
      rule: 'tag-characters',
      severity: 'high',
      snippet: toSnippetAround(maskSecrets(line), tagText.index),
      detail: tagText.text === ''
        ? 'invisible tag characters'
        : `hidden text: «${tagText.text.slice(0, SNIPPET_MAX_CHARACTERS)}»`,
    })
  }

  const matches = new Map<CompiledTextRule, RuleMatch>()
  const extras = new Map<string, ExtraFinding>()
  const skeletonHits = new Map<CompiledTextRule, number>()
  const urlFindings: Array<{
    rule: string
    severity: SkillFindingSeverity
    snippet: string
    detail: string | null
  }> = []
  let longDecodesInLine = 0
  let shortDecodesInLine = 0
  const ownedLimit = (windowStart: number) => {
    return windowStart + WINDOW_STEP_CHARACTERS
  }

  for (
    let windowStart = 0;
    windowStart < collapsed.length || windowStart === 0;
    windowStart += WINDOW_STEP_CHARACTERS
  ) {
    const window = collapsed.slice(windowStart, windowStart + WINDOW_CHARACTERS)
    const maskedWindow = maskedCollapsed.slice(
      windowStart,
      windowStart + WINDOW_CHARACTERS,
    )
    const isLastWindow = windowStart + WINDOW_CHARACTERS >= collapsed.length
    const isOwned = (index: number) => {
      return isLastWindow || windowStart + index < ownedLimit(windowStart)
    }
    const urlRanges: Array<[number, number]> = []
    const windowUrls: string[] = []

    for (const match of window.matchAll(URL_PATTERN)) {
      urlRanges.push([match.index, match.index + match[0].length])
      windowUrls.push(match[0])

      if (!isOwned(match.index)) {
        continue
      }

      const classification = classifySkillUrl(match[0])

      urlFindings.push({
        rule: classification?.rule ?? 'url',
        severity: classification?.severity ?? 'low',
        snippet: toSnippet(
          maskedWindow.slice(
            match.index,
            match.index + Math.min(match[0].length, SNIPPET_MAX_CHARACTERS + 1),
          ),
        ),
        detail: classification?.detail ?? null,
      })
    }

    for (const match of window.matchAll(IPV4_PATTERN)) {
      const isInsideUrl = urlRanges.some(([start, end]) => {
        return match.index >= start && match.index < end
      })

      if (isOwned(match.index) && !isInsideUrl && isValidIpv4(match[0])) {
        urlFindings.push({
          rule: 'url-ip-address',
          severity: 'low',
          snippet: toSnippet(match[0]),
          detail: 'IP address',
        })
      }
    }

    for (const rule of COMPILED_TEXT_RULES) {
      const known = matches.get(rule)

      if (known && !known.quoted) {
        continue
      }

      const found = findRuleMatch(rule, window, windowStart, lineContext)

      if (found && (!known || !found.quoted)) {
        matches.set(rule, found)
      }
    }

    scanWindowForExfiltration(window, windowStart, windowUrls, extras)

    for (const match of window.matchAll(BASE64_RUN_PATTERN)) {
      if (!isOwned(match.index)) {
        continue
      }

      const isShortRun = match[0].length < BASE64_LONG_RUN_CHARACTERS
      const encoded = evaluateEncodedRun({
        kind: 'base64',
        run: match[0],
        before: window.slice(Math.max(0, match.index - 40), match.index),
        index: windowStart + match.index,
        line: lineContext,
        decodesInLine: isShortRun ? shortDecodesInLine++ : longDecodesInLine++,
      })

      if (encoded) {
        keepStronger(extras, encoded)
      }
    }

    for (const match of window.matchAll(ESCAPE_RUN_PATTERN)) {
      if (!isOwned(match.index)) {
        continue
      }

      const encoded = evaluateEncodedRun({
        kind: 'hex',
        run: match[0],
        before: '',
        index: windowStart + match.index,
        line: lineContext,
        decodesInLine: longDecodesInLine++,
      })

      if (encoded) {
        keepStronger(extras, encoded)
      }
    }

    if (!extras.has('mixed-script')) {
      const word = findMixedScriptWord(window)

      if (word !== null) {
        keepStronger(extras, {
          type: 'hidden-character',
          rule: 'mixed-script',
          severity: 'medium',
          index: windowStart + window.indexOf(word),
          detail: `mixes alphabets: ${word.slice(0, 40)}`,
        })
      }
    }

    if (hasNonAscii(window)) {
      const skeleton = toConfusableSkeleton(window)

      if (skeleton !== window) {
        for (const rule of DECODED_TEXT_RULES) {
          if (!skeletonHits.has(rule) && rule.pattern.test(skeleton)) {
            skeletonHits.set(
              rule,
              windowStart + Math.max(0, findConfusableIndex(window)),
            )
          }
        }
      }
    }

    if (isLastWindow) {
      break
    }
  }

  const ruleByName = new Map(COMPILED_TEXT_RULES.map((rule) => {
    return [rule.rule, rule]
  }))

  for (const found of urlFindings) {
    add({
      type: 'url',
      rule: found.rule,
      severity: found.severity,
      snippet: found.snippet,
      detail: found.detail,
    })
  }

  for (const rule of COMPILED_TEXT_RULES) {
    const found = matches.get(rule)

    if (!found) {
      continue
    }

    if (rule.supersededBy && matches.has(ruleByName.get(rule.supersededBy)!)) {
      continue
    }

    const isCatalogText = lineContext.isCatalog
      && rule.catalogRaise === true
      && !found.quoted
    const baseSeverity = found.refinement?.severity ?? rule.severity
    const severity = found.quoted
      ? 'low'
      : isCatalogText
        ? raiseSeverity(baseSeverity)
        : baseSeverity
    const detail = found.quoted
      ? SKILL_FINDING_QUOTED_DETAIL
      : found.refinement?.detail !== undefined
        ? found.refinement.detail
        : rule.detail

    add({
      type: rule.type,
      rule: rule.rule,
      severity,
      snippet: toSnippetAround(maskedCollapsed, found.index),
      detail,
      isCatalogText,
    })
  }

  for (const [rule, index] of skeletonHits) {
    if (matches.has(rule)) {
      continue
    }

    keepStronger(extras, {
      type: 'hidden-character',
      rule: 'lookalike-letters',
      severity: 'high',
      index,
      detail: `uses lookalike letters (${rule.rule})`,
    })
  }

  for (const extra of extras.values()) {
    add({
      type: extra.type,
      rule: extra.rule,
      severity: extra.severity,
      snippet: toSnippetAround(maskedCollapsed, extra.index),
      detail: extra.detail,
    })
  }
}

function findReferenceImages(
  collapsed: string,
  references: ReadonlyMap<string, string>,
  matches: Map<string, { index: number, url: string }>,
): void {
  for (
    let windowStart = 0;
    windowStart < collapsed.length || windowStart === 0;
    windowStart += WINDOW_STEP_CHARACTERS
  ) {
    const window = collapsed.slice(windowStart, windowStart + WINDOW_CHARACTERS)

    for (const match of window.matchAll(IMAGE_REFERENCE_PATTERN)) {
      const label = (match[2] || match[1] || '').toLowerCase()
      const url = references.get(label)

      if (url !== undefined && !matches.has(label)) {
        matches.set(label, { index: windowStart + match.index, url })
      }
    }

    if (windowStart + WINDOW_CHARACTERS >= collapsed.length) {
      break
    }
  }
}

function collectReferenceDefinitions(lines: string[]): Map<string, string> {
  const references = new Map<string, string>()

  for (const line of lines) {
    const match = REFERENCE_DEFINITION_PATTERN.exec(line)

    if (match) {
      references.set(match[1]!.toLowerCase(), match[2]!)
    }
  }

  return references
}

export type SkillScanRole = 'skill-md' | 'document' | 'other'

const SKILL_SCAN_ROLE_PATHS: Readonly<Record<SkillScanRole, string>> = {
  'skill-md': SKILL_MD_FILE_NAME,
  'document': 'document.md',
  'other': '',
}

/**
 * How the path changes what a scan finds: SKILL.md gets the frontmatter
 * highlights, a `.md` or `.txt` file gets the `#!` check, and any other file
 * gets the text rules only.
 */
export function getSkillScanRole(path: string): SkillScanRole {
  if (path === SKILL_MD_FILE_NAME) {
    return 'skill-md'
  }

  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()

  return path.includes('.') && DOCUMENT_EXTENSIONS.has(extension)
    ? 'document'
    : 'other'
}

/**
 * A path that stands for a scan role, for a caller that holds file content
 * without its path, such as a blob shared by several paths.
 */
export function getSkillScanRolePath(role: SkillScanRole): string {
  return SKILL_SCAN_ROLE_PATHS[role]
}

/**
 * Highlights for the review screen, never a verdict. Scans line by line,
 * counts every finding, and returns a bounded list with the most severe
 * findings first. Hidden characters are looked for on the whole line; the
 * text rules run over 5,000 character windows that overlap by 500, so a
 * payload far along a line is found too. The text findings do not depend on
 * the path. Only three things do: the frontmatter highlights and the raised
 * severity of the description are for `SKILL.md`, and a `#!` first line is a
 * highlight only in a `.md` or `.txt` file.
 */
export function scanSkillTextWithCounts(
  path: string,
  text: string,
  maxStored: number = SKILL_FINDINGS_MAX_PER_FILE,
): SkillTextScan {
  const collector = new FindingCollector(maxStored)
  const lines = text.split('\n')
  const state = createSkillScanState(lines)
  const role = getSkillScanRole(path)
  const references = collectReferenceDefinitions(lines)
  const file: ScanFileContext = {
    path,
    isSkillMd: role === 'skill-md',
    isDocument: role === 'document',
    budget: {
      longDecodesRemaining: MAX_DECODES_PER_SCAN,
      shortDecodesRemaining: MAX_DECODES_PER_SCAN,
    },
    references,
  }
  let blankRunStart = 0
  let blankRunLength = 0
  let dynamicOpening: {
    line: number
    startLines: number
    firstCommand: string
  } | null = null

  const closeBlankRun = () => {
    if (blankRunLength > SKILL_FINDING_BLANK_RUN) {
      collector.add({
        type: 'blank-run',
        rule: 'blank-run',
        severity: 'low',
        path,
        line: blankRunStart,
        snippet: '',
        detail: `${blankRunLength} blank lines`,
        source: 'rules',
      })
    }

    blankRunLength = 0
  }

  const closeDynamicBlock = (endLines: number) => {
    if (!dynamicOpening) {
      return
    }

    const count = endLines - dynamicOpening.startLines

    if (count === 0) {
      dynamicOpening = null

      return
    }

    collector.add({
      type: 'execution',
      rule: 'dynamic-context-fence',
      severity: 'high',
      path,
      line: dynamicOpening.line,
      snippet: toSnippet(maskSecrets(`\`\`\`! ${dynamicOpening.firstCommand}`)),
      detail: `${count} ${count === 1 ? 'line' : 'lines'} would run as shell in Claude Code`,
      source: 'rules',
    })
    dynamicOpening = null
  }

  if (role === 'document' && lines[0]?.startsWith('#!')) {
    collector.add({
      type: 'file',
      rule: 'shebang-in-text',
      severity: 'low',
      path,
      line: 1,
      snippet: toSnippet(maskSecrets(lines[0])),
      detail: 'starts like a script',
      source: 'rules',
    })
  }

  if (role === 'skill-md') {
    for (const finding of scanSkillFrontmatter(text)) {
      collector.add({
        type: 'frontmatter',
        rule: finding.rule,
        severity: finding.severity,
        path,
        line: finding.line,
        snippet: toSnippet(maskSecrets(finding.snippet)),
        detail: finding.detail,
        source: 'rules',
      })
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const wasInDynamicFence = dynamicOpening !== null
    const context = advanceSkillScanState(state, line, index)

    if (!wasInDynamicFence && state.fence?.dynamic) {
      dynamicOpening = {
        line: index + 1,
        startLines: state.dynamicLines,
        firstCommand: '',
      }
    } else if (dynamicOpening) {
      if (state.fence === null) {
        closeDynamicBlock(state.dynamicLines)
      } else if (dynamicOpening.firstCommand === '' && line.trim() !== '') {
        dynamicOpening.firstCommand = line.trim()
      }
    }

    if (line.trim() === '') {
      if (blankRunLength === 0) {
        blankRunStart = index + 1
      }

      blankRunLength += 1

      continue
    }

    closeBlankRun()
    scanLine(file, index + 1, line, context, collector)

    if (references.size > 0 && line.includes('![')) {
      scanReferenceImages(file, index + 1, line, context, collector)
    }
  }

  closeBlankRun()
  closeDynamicBlock(state.dynamicLines)

  return {
    findings: collector.findings,
    counts: collector.counts,
    severityCounts: collector.severityCounts,
  }
}

function scanReferenceImages(
  file: ScanFileContext,
  lineNumber: number,
  line: string,
  context: SkillScanContext,
  collector: FindingCollector,
): void {
  const collapsed = line.replace(WHITESPACE_RUN_PATTERN, ' ')
  const found = new Map<string, { index: number, url: string }>()

  findReferenceImages(collapsed, file.references, found)

  for (const { index, url } of found.values()) {
    const hostname = readHostname(url)

    if (hostname === null) {
      continue
    }

    const hasQuery = REFERENCE_QUERY_PATTERN.test(url)

    collector.add({
      type: 'exfiltration',
      rule: hasQuery ? 'markdown-image-query' : 'markdown-image-external',
      severity: hasQuery ? 'high' : 'medium',
      path: file.path,
      line: lineNumber,
      snippet: toSnippetAround(maskSecrets(collapsed), index),
      detail: describeWithContext(
        hasQuery ? `sends text to ${hostname}` : hostname,
        context,
        false,
      ),
      source: 'rules',
    })
  }
}

export function scanSkillText(
  path: string,
  text: string,
  maxStored: number = SKILL_FINDINGS_MAX_PER_FILE,
): SkillFinding[] {
  return scanSkillTextWithCounts(path, text, maxStored).findings
}

/**
 * Keeps the most severe `max` findings (severity, then position) and, past
 * that, the first of the most severe finding of every type that would
 * otherwise vanish from the list.
 */
export function capSkillFindings(
  findings: SkillFinding[],
  max: number,
): SkillFinding[] {
  return selectSeverityFirst(
    findings.map((finding, sequence) => {
      return { finding, sequence }
    }),
    max,
  )
}

export function summarizeSkillFindings(
  findings: SkillFinding[],
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const finding of findings) {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1
  }

  return counts
}

export function countSkillFindingSeverities(
  findings: SkillFinding[],
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
  }

  return counts
}

/**
 * The shape stored in `skill_versions.findings`: the rules version, the
 * severity counts and the type counts in one flat JSON object, such as
 * `{ "rulesVersion": 2, "high": 1, "execution": 1 }`. Zero counts are left
 * out.
 */
export function toStoredFindingCounts(
  typeCounts: Record<string, number>,
  severityCounts: Record<string, number>,
): Record<string, number> {
  const stored: Record<string, number> = {
    [RULES_VERSION_KEY]: SKILL_FINDING_RULES_VERSION,
  }

  for (const severity of SKILL_FINDING_SEVERITIES) {
    if ((severityCounts[severity] ?? 0) > 0) {
      stored[severity] = severityCounts[severity]!
    }
  }

  for (const type of SKILL_FINDING_TYPES) {
    if ((typeCounts[type] ?? 0) > 0) {
      stored[type] = typeCounts[type]!
    }
  }

  return stored
}

export function readStoredFindingCounts(
  stored: Record<string, number> | null | undefined,
): {
  rulesVersion: number
  typeCounts: Record<string, number>
  severityCounts: Record<string, number>
} {
  const typeCounts: Record<string, number> = {}
  const severityCounts: Record<string, number> = {}

  for (const [key, count] of Object.entries(stored ?? {})) {
    if (key === RULES_VERSION_KEY || key.startsWith(JEV_COUNT_PREFIX)) {
      continue
    }

    if (isSkillFindingSeverity(key)) {
      severityCounts[key] = count
    } else {
      typeCounts[key] = count
    }
  }

  return {
    rulesVersion: stored?.[RULES_VERSION_KEY] ?? 1,
    typeCounts,
    severityCounts,
  }
}

/**
 * The number of "Look closely" highlights in stored counts, or 0 for counts
 * stored before the rules had severities.
 */
export function countStoredHighlights(
  stored: Record<string, number> | null | undefined,
): number {
  return readStoredFindingCounts(stored).severityCounts.high ?? 0
}

/**
 * Counts stored by an older rule set, or before counts carried a version,
 * are not comparable with a scan by the current rules. A skill version with
 * no counts at all has nothing to re-scan.
 */
export function isStoredFindingCountsStale(
  stored: Record<string, number> | null | undefined,
): boolean {
  return Boolean(stored)
    && (stored?.[RULES_VERSION_KEY] ?? 1) < SKILL_FINDING_RULES_VERSION
}
