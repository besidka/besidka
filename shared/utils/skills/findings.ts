import {
  SKILL_FINDINGS_MAX_PER_FILE,
  SKILL_FINDING_BLANK_RUN,
  SKILL_FINDING_LONG_LINE,
} from '#shared/utils/skills-policy'

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

const SNIPPET_MAX_CHARACTERS = 120
const SCAN_LINE_MAX_CHARACTERS = 5000
const HIDDEN_CHARACTER_PATTERN
  = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/g
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

const SHELL_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  { name: 'curl', pattern: /\bcurl\b/i },
  { name: 'wget', pattern: /\bwget\b/i },
  { name: '| sh', pattern: /\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i },
  { name: 'bash -c', pattern: /\b(?:ba|z|da)?sh\s+-c\b/i },
  { name: 'rm -rf', pattern: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i },
  { name: 'sudo', pattern: /\bsudo\b/i },
  { name: 'chmod +x', pattern: /\bchmod\s+\+x\b/i },
  { name: 'eval', pattern: /\beval\b/i },
  { name: 'base64 -d', pattern: /\bbase64\s+(?:-d|--decode)\b/i },
  { name: 'pip install', pattern: /\bpip3?\s+install\b/i },
  { name: 'npm i', pattern: /\bnpm\s+(?:i|install)\b/i },
  {
    name: 'powershell -enc',
    pattern: /\bpowershell(?:\.exe)?\s[^\n]{0,80}?-e(?:nc|ncodedcommand)?\b/i,
  },
]

const INJECTION_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  {
    name: 'ignore previous',
    pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\b/i,
  },
  {
    name: 'disregard previous',
    pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\b/i,
  },
  { name: 'system prompt', pattern: /\bsystem\s+prompt\b/i },
]

const SECRET_PATTERNS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  { name: 'API_KEY', pattern: /\b[A-Z0-9_]*API_KEY\b/ },
  { name: '.env', pattern: /(?:^|[\s"'`(=/])\.env(?:\.[a-z]{1,12})?(?![\w-])/ },
  { name: '~/.ssh', pattern: /~\/\.ssh\b/ },
]

export function formatHiddenCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0

  return `⟨U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}⟩`
}

/**
 * Makes every bidi, zero-width and format character visible as `⟨U+202E⟩`.
 */
export function showHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTER_PATTERN, formatHiddenCharacter)
}

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

function scanLine(
  path: string,
  lineNumber: number,
  line: string,
  findings: SkillFinding[],
): void {
  const add = (
    type: SkillFindingType,
    snippet: string,
    detail: string | null = null,
  ) => {
    findings.push({
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

  const scanned = line.length > SCAN_LINE_MAX_CHARACTERS
    ? line.slice(0, SCAN_LINE_MAX_CHARACTERS)
    : line

  const hiddenMatches = scanned.match(HIDDEN_CHARACTER_PATTERN)

  if (hiddenMatches) {
    add('hidden-character', scanned, `${hiddenMatches.length} hidden`)
  }

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
 * Highlights for the review screen, never a verdict. Scans line by line with
 * linear patterns, because the input is an untrusted file of up to 1 MiB,
 * and stops adding findings after the per-file cap.
 */
export function scanSkillText(path: string, text: string): SkillFinding[] {
  const findings: SkillFinding[] = []
  const lines = text.split('\n')
  let blankRunStart = 0
  let blankRunLength = 0

  const closeBlankRun = () => {
    if (blankRunLength > SKILL_FINDING_BLANK_RUN) {
      findings.push({
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
    } else {
      closeBlankRun()
      scanLine(path, index + 1, line, findings)
    }

    if (findings.length >= SKILL_FINDINGS_MAX_PER_FILE) {
      return findings.slice(0, SKILL_FINDINGS_MAX_PER_FILE)
    }
  }

  closeBlankRun()

  return findings.slice(0, SKILL_FINDINGS_MAX_PER_FILE)
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
