import {
  SKILL_FINDINGS_MAX_PER_FILE,
  SKILL_FINDING_BLANK_RUN,
  SKILL_FINDING_LONG_LINE,
} from '#shared/utils/skills-policy'
import {
  HIDDEN_CHARACTER_PATTERN,
  showHiddenCharacters,
} from '#shared/utils/skills/hidden-characters'

export {
  formatHiddenCharacter,
  showHiddenCharacters,
} from '#shared/utils/skills/hidden-characters'

export const SKILL_FINDING_RULES_VERSION = 2

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

export type QuoteMode = 'quotes' | 'inline-code'

export const SKILL_FINDING_QUOTED_DETAIL = 'quoted, probably an example'

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

interface TextRule {
  rule: string
  type: SkillFindingType
  severity: SkillFindingSeverity
  detail: string | null
  pattern: RegExp
  quote?: QuoteMode
  accept?: (match: RegExpExecArray) => boolean
}

interface CompiledTextRule extends TextRule {
  scanner: RegExp
}

interface RuleMatch {
  index: number
  length: number
  quoted: boolean
}

function hasRecursiveForceFlags(match: RegExpExecArray): boolean {
  const flags = match[1]!.toLowerCase()

  return flags.includes('r') && flags.includes('f')
}

/**
 * Text rules run on a line whose whitespace runs are collapsed to one space,
 * so none of them needs `\s+` or `\s*`, and each has a single, unambiguous
 * way to match: nothing can backtrack quadratically on an untrusted line.
 * Every rule has an id that never changes; later rule sets add rows here.
 */
const TEXT_RULES: ReadonlyArray<TextRule> = [
  {
    rule: 'shell-curl',
    type: 'shell',
    severity: 'low',
    detail: 'curl',
    pattern: /\bcurl\b/i,
  },
  {
    rule: 'shell-wget',
    type: 'shell',
    severity: 'low',
    detail: 'wget',
    pattern: /\bwget\b/i,
  },
  {
    rule: 'shell-pipe-to-shell',
    type: 'shell',
    severity: 'low',
    detail: '| sh',
    pattern: /\| ?(?:sudo )?(?:ba|z|da)?sh\b/i,
  },
  {
    rule: 'shell-shell-c',
    type: 'shell',
    severity: 'medium',
    detail: 'bash -c',
    pattern: /\b(?:ba|z|da)?sh -c\b/i,
  },
  {
    rule: 'shell-sudo',
    type: 'shell',
    severity: 'low',
    detail: 'sudo',
    pattern: /\bsudo\b/i,
  },
  {
    rule: 'shell-chmod-x',
    type: 'shell',
    severity: 'low',
    detail: 'chmod +x',
    pattern: /\bchmod \+x\b/i,
  },
  {
    rule: 'shell-eval',
    type: 'shell',
    severity: 'low',
    detail: 'eval',
    pattern: /\beval\b/i,
  },
  {
    rule: 'shell-base64-decode',
    type: 'shell',
    severity: 'medium',
    detail: 'base64 -d',
    pattern: /\bbase64 (?:-d|--decode)\b/i,
  },
  {
    rule: 'shell-pip-install',
    type: 'shell',
    severity: 'low',
    detail: 'pip install',
    pattern: /\bpip3? install\b/i,
  },
  {
    rule: 'shell-npm-install',
    type: 'shell',
    severity: 'low',
    detail: 'npm i',
    pattern: /\bnpm (?:i|install)\b/i,
  },
  {
    rule: 'shell-powershell-encoded',
    type: 'shell',
    severity: 'medium',
    detail: 'powershell -enc',
    pattern: /\bpowershell(?:\.exe)? (?:[^ ]{1,40} ){0,8}-e(?:nc|ncodedcommand)?\b/i,
  },
  {
    rule: 'shell-rm-recursive-force',
    type: 'shell',
    severity: 'medium',
    detail: 'rm -rf',
    pattern: /\brm((?: -[a-z]+)+)/i,
    accept: hasRecursiveForceFlags,
  },
  {
    rule: 'injection-ignore-previous',
    type: 'injection',
    severity: 'high',
    detail: 'ignore previous',
    pattern: /\bignore (?:all )?(?:the )?(?:previous|prior|above)\b/i,
    quote: 'quotes',
  },
  {
    rule: 'injection-disregard-previous',
    type: 'injection',
    severity: 'high',
    detail: 'disregard previous',
    pattern: /\bdisregard (?:all )?(?:the )?(?:previous|prior|above)\b/i,
    quote: 'quotes',
  },
  {
    rule: 'injection-system-prompt',
    type: 'injection',
    severity: 'low',
    detail: 'system prompt',
    pattern: /\bsystem prompt\b/i,
  },
  {
    rule: 'secret-api-key',
    type: 'secret',
    severity: 'low',
    detail: 'API_KEY',
    pattern: /API_KEY\b/,
  },
  {
    rule: 'secret-env-file',
    type: 'secret',
    severity: 'low',
    detail: '.env',
    pattern: /(?:^|[\s"'`(=/])\.env(?:\.[a-z]{1,12})?(?![\w-])/,
  },
  {
    rule: 'secret-ssh-path',
    type: 'secret',
    severity: 'medium',
    detail: '~/.ssh',
    pattern: /~\/\.ssh\b/,
    quote: 'quotes',
  },
]

const COMPILED_TEXT_RULES: ReadonlyArray<CompiledTextRule> = TEXT_RULES.map(
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

interface LineScanContext {
  collapsed: string
  context: SkillScanContext
  path: string
  lineNumber: number
  hasUrl: boolean | null
}

function describeWithContext(
  detail: string | null,
  context: SkillScanContext,
): string | null {
  const note = context.inDynamicFence
    ? 'in a ```! block'
    : context.inCodeFence
      ? 'in a code block'
      : null

  return [detail, note].filter(Boolean).join(', ') || null
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

    const index = windowStart + match.index

    if (!rule.quote) {
      return { index, length: match[0].length, quoted: false }
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
      return { index, length: match[0].length, quoted: false }
    }

    firstQuoted ??= { index, length: match[0].length, quoted: true }
  }

  return firstQuoted
}

function scanLine(
  path: string,
  lineNumber: number,
  line: string,
  context: SkillScanContext,
  collector: FindingCollector,
): void {
  const add = (input: {
    type: SkillFindingType
    rule: string
    severity: SkillFindingSeverity
    snippet: string
    detail?: string | null
  }) => {
    collector.add({
      type: input.type,
      rule: input.rule,
      severity: input.severity,
      path,
      line: lineNumber,
      snippet: input.snippet,
      detail: describeWithContext(input.detail ?? null, context),
      source: 'rules',
    })
  }

  if (line.length > SKILL_FINDING_LONG_LINE) {
    add({
      type: 'long-line',
      rule: 'long-line',
      severity: 'low',
      snippet: toSnippet(line.slice(0, SNIPPET_MAX_CHARACTERS + 1)),
      detail: `${line.length} characters`,
    })
  }

  const hiddenIndex = line.search(HIDDEN_CHARACTER_PATTERN)

  if (hiddenIndex !== -1) {
    const hiddenMatches = line.match(HIDDEN_CHARACTER_PATTERN)!

    add({
      type: 'hidden-character',
      rule: 'hidden-character',
      severity: 'medium',
      snippet: toSnippetAround(line, hiddenIndex),
      detail: `${hiddenMatches.length} hidden`,
    })
  }

  const collapsed = line.replace(WHITESPACE_RUN_PATTERN, ' ')
  const lineContext: LineScanContext = {
    collapsed,
    context,
    path,
    lineNumber,
    hasUrl: null,
  }
  const matches = new Map<CompiledTextRule, RuleMatch>()
  const ownedLimit = (windowStart: number) => {
    return windowStart + WINDOW_STEP_CHARACTERS
  }

  for (
    let windowStart = 0;
    windowStart < collapsed.length || windowStart === 0;
    windowStart += WINDOW_STEP_CHARACTERS
  ) {
    const window = collapsed.slice(windowStart, windowStart + WINDOW_CHARACTERS)
    const isLastWindow = windowStart + WINDOW_CHARACTERS >= collapsed.length
    const isOwned = (index: number) => {
      return isLastWindow || windowStart + index < ownedLimit(windowStart)
    }

    for (const match of window.matchAll(URL_PATTERN)) {
      if (isOwned(match.index)) {
        add({
          type: 'url',
          rule: 'url',
          severity: 'low',
          snippet: toSnippet(match[0].slice(0, SNIPPET_MAX_CHARACTERS + 1)),
        })
      }
    }

    for (const match of window.matchAll(IPV4_PATTERN)) {
      if (isOwned(match.index) && isValidIpv4(match[0])) {
        add({
          type: 'url',
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

    if (isLastWindow) {
      break
    }
  }

  for (const rule of COMPILED_TEXT_RULES) {
    const found = matches.get(rule)

    if (!found) {
      continue
    }

    add({
      type: rule.type,
      rule: rule.rule,
      severity: found.quoted ? 'low' : rule.severity,
      snippet: toSnippetAround(collapsed, found.index),
      detail: found.quoted ? SKILL_FINDING_QUOTED_DETAIL : rule.detail,
    })
  }
}

/**
 * Highlights for the review screen, never a verdict. Scans line by line,
 * counts every finding, and returns a bounded list with the most severe
 * findings first. Hidden characters are looked for on the whole line; the
 * text rules run over 5,000 character windows that overlap by 500, so a
 * payload far along a line is found too. Nothing here depends on the file
 * path, so the same text gives the same findings wherever it lives.
 */
export function scanSkillTextWithCounts(
  path: string,
  text: string,
  maxStored: number = SKILL_FINDINGS_MAX_PER_FILE,
): SkillTextScan {
  const collector = new FindingCollector(maxStored)
  const lines = text.split('\n')
  const state = createSkillScanState(lines)
  let blankRunStart = 0
  let blankRunLength = 0

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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const context = advanceSkillScanState(state, line, index)

    if (line.trim() === '') {
      if (blankRunLength === 0) {
        blankRunStart = index + 1
      }

      blankRunLength += 1

      continue
    }

    closeBlankRun()
    scanLine(path, index + 1, line, context, collector)
  }

  closeBlankRun()

  return {
    findings: collector.findings,
    counts: collector.counts,
    severityCounts: collector.severityCounts,
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
