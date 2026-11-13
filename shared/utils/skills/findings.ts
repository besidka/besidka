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

export const SKILL_FINDING_TYPES = [
  'url',
  'shell',
  'hidden-character',
  'long-line',
  'blank-run',
  'injection',
  'secret',
] as const

export type SkillFindingType = typeof SKILL_FINDING_TYPES[number]

export interface SkillFinding {
  type: SkillFindingType
  path: string
  line: number
  snippet: string
  detail: string | null
}

export interface SkillTextScan {
  findings: SkillFinding[]
  counts: Record<string, number>
}

const SNIPPET_MAX_CHARACTERS = 120
const SCAN_LINE_MAX_CHARACTERS = 5000
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const WHITESPACE_RUN_PATTERN = /\s+/g
const REMOVE_FLAGS_PATTERN = /\brm((?: -[a-z]+)+)/i

/**
 * The shell, injection and secret patterns run on a line whose whitespace
 * runs are collapsed to one space, so none of them needs `\s+` or `\s*`,
 * and each has a single, unambiguous way to match: nothing can backtrack
 * quadratically on an untrusted line.
 */
const SHELL_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  { name: 'curl', pattern: /\bcurl\b/i },
  { name: 'wget', pattern: /\bwget\b/i },
  { name: '| sh', pattern: /\| ?(?:sudo )?(?:ba|z|da)?sh\b/i },
  { name: 'bash -c', pattern: /\b(?:ba|z|da)?sh -c\b/i },
  { name: 'sudo', pattern: /\bsudo\b/i },
  { name: 'chmod +x', pattern: /\bchmod \+x\b/i },
  { name: 'eval', pattern: /\beval\b/i },
  { name: 'base64 -d', pattern: /\bbase64 (?:-d|--decode)\b/i },
  { name: 'pip install', pattern: /\bpip3? install\b/i },
  { name: 'npm i', pattern: /\bnpm (?:i|install)\b/i },
  {
    name: 'powershell -enc',
    pattern: /\bpowershell(?:\.exe)? (?:[^ ]{1,40} ){0,8}-e(?:nc|ncodedcommand)?\b/i,
  },
]

const INJECTION_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  {
    name: 'ignore previous',
    pattern: /\bignore (?:all )?(?:the )?(?:previous|prior|above)\b/i,
  },
  {
    name: 'disregard previous',
    pattern: /\bdisregard (?:all )?(?:the )?(?:previous|prior|above)\b/i,
  },
  { name: 'system prompt', pattern: /\bsystem prompt\b/i },
]

const SECRET_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  { name: 'API_KEY', pattern: /API_KEY\b/ },
  { name: '.env', pattern: /(?:^|[\s"'`(=/])\.env(?:\.[a-z]{1,12})?(?![\w-])/ },
  { name: '~/.ssh', pattern: /~\/\.ssh\b/ },
]

function toSnippet(text: string): string {
  const visible = showHiddenCharacters(text.trim())

  return visible.length > SNIPPET_MAX_CHARACTERS
    ? `${visible.slice(0, SNIPPET_MAX_CHARACTERS)}...`
    : visible
}

function isValidIpv4(address: string): boolean {
  return address.split('.').every((octet) => {
    return Number(octet) <= 255
  })
}

function hasRecursiveForceRemove(line: string): boolean {
  const match = REMOVE_FLAGS_PATTERN.exec(line)

  if (!match) {
    return false
  }

  const flags = match[1]!.toLowerCase()

  return flags.includes('r') && flags.includes('f')
}

/**
 * Collects findings while counting every one of them. Only the first
 * `maxStored` are kept, plus the first finding of any type that would
 * otherwise be missing, so a file full of links can never hide one shell
 * command.
 */
class FindingCollector {
  readonly findings: SkillFinding[] = []

  readonly counts: Record<string, number> = {}

  private readonly storedTypes = new Set<string>()

  constructor(private readonly maxStored: number) {}

  add(finding: SkillFinding): void {
    this.counts[finding.type] = (this.counts[finding.type] ?? 0) + 1

    if (
      this.findings.length < this.maxStored
      || !this.storedTypes.has(finding.type)
    ) {
      this.findings.push(finding)
      this.storedTypes.add(finding.type)
    }
  }
}

function scanLine(
  path: string,
  lineNumber: number,
  line: string,
  collector: FindingCollector,
): void {
  const add = (
    type: SkillFindingType,
    snippet: string,
    detail: string | null = null,
  ) => {
    collector.add({
      type,
      path,
      line: lineNumber,
      snippet: toSnippet(snippet),
      detail,
    })
  }

  if (line.length > SKILL_FINDING_LONG_LINE) {
    add('long-line', line, `${line.length} characters`)
  }

  const hiddenMatches = line.match(HIDDEN_CHARACTER_PATTERN)

  if (hiddenMatches) {
    add('hidden-character', line, `${hiddenMatches.length} hidden`)
  }

  const scanned = (
    line.length > SCAN_LINE_MAX_CHARACTERS
      ? line.slice(0, SCAN_LINE_MAX_CHARACTERS)
      : line
  ).replace(WHITESPACE_RUN_PATTERN, ' ')

  for (const match of scanned.matchAll(URL_PATTERN)) {
    add('url', match[0])
  }

  for (const match of scanned.matchAll(IPV4_PATTERN)) {
    if (isValidIpv4(match[0])) {
      add('url', match[0], 'IP address')
    }
  }

  for (const { name, pattern } of SHELL_PATTERNS) {
    if (pattern.test(scanned)) {
      add('shell', scanned, name)
    }
  }

  if (hasRecursiveForceRemove(scanned)) {
    add('shell', scanned, 'rm -rf')
  }

  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(scanned)) {
      add('injection', scanned, name)
    }
  }

  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(scanned)) {
      add('secret', scanned, name)
    }
  }
}

/**
 * Highlights for the review screen, never a verdict. Scans line by line,
 * counts every finding, and returns a bounded list. Hidden characters are
 * looked for on the whole line; only the text patterns see its first 5,000
 * characters.
 */
export function scanSkillTextWithCounts(
  path: string,
  text: string,
): SkillTextScan {
  const collector = new FindingCollector(SKILL_FINDINGS_MAX_PER_FILE)
  const lines = text.split('\n')
  let blankRunStart = 0
  let blankRunLength = 0

  const closeBlankRun = () => {
    if (blankRunLength > SKILL_FINDING_BLANK_RUN) {
      collector.add({
        type: 'blank-run',
        path,
        line: blankRunStart,
        snippet: '',
        detail: `${blankRunLength} blank lines`,
      })
    }

    blankRunLength = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!

    if (line.trim() === '') {
      if (blankRunLength === 0) {
        blankRunStart = index + 1
      }

      blankRunLength += 1

      continue
    }

    closeBlankRun()
    scanLine(path, index + 1, line, collector)
  }

  closeBlankRun()

  return { findings: collector.findings, counts: collector.counts }
}

export function scanSkillText(path: string, text: string): SkillFinding[] {
  return scanSkillTextWithCounts(path, text).findings
}

/**
 * Keeps the first `max` findings and, past that, the first finding of every
 * type that would otherwise vanish from the list.
 */
export function capSkillFindings(
  findings: SkillFinding[],
  max: number,
): SkillFinding[] {
  if (findings.length <= max) {
    return findings
  }

  const kept = findings.slice(0, max)
  const seen = new Set(kept.map((finding) => {
    return finding.type
  }))

  for (const finding of findings.slice(max)) {
    if (!seen.has(finding.type)) {
      seen.add(finding.type)
      kept.push(finding)
    }
  }

  return kept
}

export function summariseSkillFindings(
  findings: SkillFinding[],
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const finding of findings) {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1
  }

  return counts
}
