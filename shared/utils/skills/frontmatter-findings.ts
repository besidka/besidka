import { readSkillFrontmatterData } from '#shared/utils/skills/frontmatter'
import type { SkillFindingSeverity } from '#shared/utils/skills/findings'

export interface FrontmatterFinding {
  rule: string
  severity: SkillFindingSeverity
  line: number
  snippet: string
  detail: string
}

export const BROAD_TRIGGER_PATTERN
  = /\b(?:always|automatically) (?:use|activate|load|invoke|run|apply) (?:this skill|me)\b|\b(?:use|activate|load|invoke|apply) (?:this skill )?(?:for|on|before|with|in) (?:every|all|any) (?:request|message|task|conversation|prompt|question)s?\b/i

const SHELL_GRANT_PATTERN
  = /^(?:Bash|Shell|PowerShell)(?:\((?:\*{1,2}|[^)]{0,40}\*)\))?$/
const BROAD_TOOL_NAMES: ReadonlySet<string> = new Set([
  'WebFetch',
  'Write',
  'Edit',
  '*',
])
const MCP_WILDCARD_PATTERN = /^mcp__[A-Za-z0-9_-]{0,80}\*$/
const XML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:_-]{0,40}(?: [^<>]{0,100})?>/
const RUNTIME_KEYS: readonly string[] = ['context', 'agent', 'model']
const WHITESPACE_RUN_PATTERN = /\s+/g
const MAX_TOOL_FINDINGS = 10
const FRONTMATTER_FIRST_LINE = 2

function escapeForPattern(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findKeyLine(raw: string, key: string): { line: number, text: string } {
  const pattern = new RegExp(`^["']?${escapeForPattern(key)}["']? ?:`)
  const lines = raw.split('\n')
  const index = lines.findIndex((line) => {
    return pattern.test(line)
  })

  return index === -1
    ? { line: FRONTMATTER_FIRST_LINE, text: '' }
    : { line: index + FRONTMATTER_FIRST_LINE, text: lines[index]!.trim() }
}

function toText(value: unknown): string {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    ? String(value)
    : ''
}

/**
 * Splits an `allowed-tools` value into entries. Spaces and commas separate
 * entries, except inside parentheses, so `Bash(git status)` stays whole.
 */
export function splitAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(toText).map((tool) => {
      return tool.trim()
    }).filter(Boolean)
  }

  if (typeof value !== 'string') {
    return []
  }

  const tools: string[] = []
  let current = ''
  let depth = 0

  for (const character of value) {
    if (character === '(') {
      depth++
    } else if (character === ')' && depth > 0) {
      depth--
    }

    if (depth === 0 && (character === ' ' || character === ',' || character === '\n' || character === '\t')) {
      if (current !== '') {
        tools.push(current)
      }

      current = ''
    } else {
      current += character
    }
  }

  if (current !== '') {
    tools.push(current)
  }

  return tools
}

function scanAllowedTools(
  value: unknown,
  keyLine: { line: number, text: string },
): FrontmatterFinding[] {
  const findings: FrontmatterFinding[] = []

  for (const tool of splitAllowedTools(value).slice(0, 50)) {
    const isShellGrant = SHELL_GRANT_PATTERN.test(tool)
    const isBroadGrant = BROAD_TOOL_NAMES.has(tool)
      || MCP_WILDCARD_PATTERN.test(tool)

    if (!isShellGrant && !isBroadGrant) {
      continue
    }

    findings.push({
      rule: isShellGrant
        ? 'frontmatter-allowed-tools-shell'
        : 'frontmatter-allowed-tools-broad',
      severity: isShellGrant ? 'high' : 'medium',
      line: keyLine.line,
      snippet: keyLine.text,
      detail: `requested tools, not granted: ${tool.slice(0, 60)}`,
    })

    if (findings.length >= MAX_TOOL_FINDINGS) {
      break
    }
  }

  return findings
}

/**
 * Highlights for the frontmatter of SKILL.md, read from the parsed object and
 * not from lines: the `hooks` key, broad `allowed-tools` requests, keys only
 * Claude Code reads, an over-broad trigger in the description and XML tags in
 * the name or description. Each finding sits on the line of its key. Text
 * rules for the description, argument hint and metadata run on the lines
 * themselves.
 */
export function scanSkillFrontmatter(text: string): FrontmatterFinding[] {
  const parsed = readSkillFrontmatterData(text)

  if (!parsed) {
    return []
  }

  const { data, raw } = parsed
  const findings: FrontmatterFinding[] = []

  if ('hooks' in data) {
    const keyLine = findKeyLine(raw, 'hooks')

    findings.push({
      rule: 'frontmatter-hooks',
      severity: 'high',
      line: keyLine.line,
      snippet: keyLine.text,
      detail: 'hooks',
    })
  }

  if ('allowed-tools' in data) {
    findings.push(...scanAllowedTools(
      data['allowed-tools'],
      findKeyLine(raw, 'allowed-tools'),
    ))
  }

  for (const key of RUNTIME_KEYS) {
    if (key in data) {
      const keyLine = findKeyLine(raw, key)

      findings.push({
        rule: 'frontmatter-runtime-key',
        severity: 'low',
        line: keyLine.line,
        snippet: keyLine.text,
        detail: key,
      })
    }
  }

  if (toText(data.shell).trim().toLowerCase() === 'powershell') {
    const keyLine = findKeyLine(raw, 'shell')

    findings.push({
      rule: 'frontmatter-runtime-key',
      severity: 'low',
      line: keyLine.line,
      snippet: keyLine.text,
      detail: 'shell: powershell',
    })
  }

  const description = toText(data.description)
    .replace(WHITESPACE_RUN_PATTERN, ' ')

  if (description !== '' && BROAD_TRIGGER_PATTERN.test(description)) {
    const keyLine = findKeyLine(raw, 'description')

    findings.push({
      rule: 'broad-trigger',
      severity: 'medium',
      line: keyLine.line,
      snippet: keyLine.text,
      detail: 'asks to be used for every request',
    })
  }

  for (const key of ['name', 'description']) {
    if (XML_TAG_PATTERN.test(toText(data[key]))) {
      const keyLine = findKeyLine(raw, key)

      findings.push({
        rule: 'frontmatter-xml-tag',
        severity: 'medium',
        line: keyLine.line,
        snippet: keyLine.text,
        detail: `XML tag in ${key}`,
      })
    }
  }

  return findings
}
