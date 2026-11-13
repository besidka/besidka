import { parse } from 'yaml'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_MAX_FRONTMATTER_BYTES,
  isReservedSkillSlashName,
  isSkillNameValid,
} from '#shared/utils/skills-policy'

export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_COMPATIBILITY_MAX = 500
export const SKILL_LICENSE_FIELD_MAX = 500
export const SKILL_METADATA_MAX_ENTRIES = 50
export const SKILL_METADATA_VALUE_MAX = 500
export const SKILL_ALLOWED_TOOLS_MAX = 50
const MAX_FRONTMATTER_WARNINGS = 20

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
  'disable-model-invocation',
  'user-invocable',
  'argument-hint',
])

const NAME_KEY_LINE_PATTERN = /^(["']?)name\1[ \t]*:/gm
const MAPPING_LINE_PATTERN = /^([A-Za-z][\w-]*):[ \t]+(\S.*)$/
const UNSAFE_PLAIN_START_PATTERN = /^["'[{|>&*!%@`#]/
const textEncoder = new TextEncoder()

export type SkillFrontmatterErrorCode
  = | 'frontmatter-missing'
    | 'frontmatter-unterminated'
    | 'frontmatter-too-large'
    | 'frontmatter-invalid'
    | 'name-missing'
    | 'name-invalid'
    | 'description-missing'

export interface SkillInvocationDefaults {
  modelInvocable: boolean
  slashCommand: boolean
  argumentHint: string | null
}

export interface SkillFrontmatter {
  name: string
  description: string
  license: string | null
  compatibility: string | null
  metadata: Record<string, string> | null
  allowedTools: string[] | null
  defaults: SkillInvocationDefaults
}

export type ParsedSkillMarkdown
  = | {
    ok: true
    frontmatter: SkillFrontmatter
    body: string
    warnings: string[]
  }
  | {
    ok: false
    code: SkillFrontmatterErrorCode
    message: string
  }

type FrontmatterSplit
  = | { ok: true, raw: string, body: string }
    | { ok: false, code: SkillFrontmatterErrorCode, message: string }

function failure(
  code: SkillFrontmatterErrorCode,
  message: string,
): { ok: false, code: SkillFrontmatterErrorCode, message: string } {
  return { ok: false, code, message }
}

export function normaliseSkillText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function isDelimiterLine(line: string): boolean {
  return /^---[ \t]*$/.test(line)
}

export function splitSkillFrontmatter(text: string): FrontmatterSplit {
  const lines = normaliseSkillText(text).split('\n')

  if (!isDelimiterLine(lines[0] ?? '')) {
    return failure(
      'frontmatter-missing',
      'SKILL.md must start with a --- frontmatter block',
    )
  }

  const closingIndex = lines.findIndex((line, index) => {
    return index > 0 && isDelimiterLine(line)
  })

  if (closingIndex === -1) {
    return failure(
      'frontmatter-unterminated',
      'The frontmatter block in SKILL.md has no closing ---',
    )
  }

  const raw = lines.slice(1, closingIndex).join('\n')

  if (textEncoder.encode(raw).byteLength > SKILL_MAX_FRONTMATTER_BYTES) {
    return failure(
      'frontmatter-too-large',
      `The frontmatter block is over ${SKILL_MAX_FRONTMATTER_BYTES} bytes`,
    )
  }

  return { ok: true, raw, body: lines.slice(closingIndex + 1).join('\n') }
}

function parseYamlStrict(raw: string): unknown {
  return parse(raw, {
    strict: false,
    maxAliasCount: 0,
    prettyErrors: false,
    uniqueKeys: false,
    logLevel: 'error',
  })
}

function quoteLooseValues(raw: string): string {
  return raw.split('\n').map((line) => {
    const match = MAPPING_LINE_PATTERN.exec(line)

    if (!match) {
      return line
    }

    const value = match[2]!.trim()

    if (UNSAFE_PLAIN_START_PATTERN.test(value) || !value.includes(':')) {
      return line
    }

    return `${match[1]}: ${JSON.stringify(value)}`
  }).join('\n')
}

function parseFrontmatterBlock(raw: string): Record<string, unknown> | null {
  let parsed: unknown

  try {
    parsed = parseYamlStrict(raw)
  } catch {
    try {
      parsed = parseYamlStrict(quoteLooseValues(raw))
    } catch {
      return null
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  return parsed as Record<string, unknown>
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

function toLenientBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()

    if (normalised === 'true') {
      return true
    }

    if (normalised === 'false') {
      return false
    }
  }

  return null
}

function readOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
  warnings: string[],
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!isScalar(value)) {
    warnings.push(`"${label}" is not text and was ignored`)

    return null
  }

  const text = String(value).trim()

  if (text === '') {
    return null
  }

  if (text.length > maxLength) {
    warnings.push(`"${label}" was cut to ${maxLength} characters`)

    return text.slice(0, maxLength)
  }

  return text
}

function readMetadata(
  value: unknown,
  warnings: string[],
): Record<string, string> | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push('"metadata" is not a map and was ignored')

    return null
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const metadata: Record<string, string> = {}
  let hasStringifiedValue = false

  const keptEntries = entries.slice(0, SKILL_METADATA_MAX_ENTRIES)

  for (const [key, entryValue] of keptEntries) {
    let text: string

    if (typeof entryValue === 'string') {
      text = entryValue
    } else {
      hasStringifiedValue = true
      text = isScalar(entryValue)
        ? String(entryValue)
        : JSON.stringify(entryValue) ?? ''
    }

    metadata[key] = text.slice(0, SKILL_METADATA_VALUE_MAX)
  }

  if (hasStringifiedValue) {
    warnings.push('Non-text "metadata" values were converted to text')
  }

  if (entries.length > SKILL_METADATA_MAX_ENTRIES) {
    warnings.push(
      `"metadata" was cut to ${SKILL_METADATA_MAX_ENTRIES} entries`,
    )
  }

  return Object.keys(metadata).length > 0 ? metadata : null
}

function readAllowedTools(value: unknown, warnings: string[]): string[] | null {
  if (value === undefined || value === null) {
    return null
  }

  let tools: string[]

  if (typeof value === 'string') {
    tools = value.split(/[\s,]+/)
  } else if (Array.isArray(value)) {
    tools = value.filter(isScalar).map(String)
  } else {
    warnings.push('"allowed-tools" is not text or a list and was ignored')

    return null
  }

  const cleaned = tools
    .map((tool) => {
      return tool.trim()
    })
    .filter((tool) => {
      return tool !== ''
    })

  if (cleaned.length > SKILL_ALLOWED_TOOLS_MAX) {
    warnings.push(
      `"allowed-tools" was cut to ${SKILL_ALLOWED_TOOLS_MAX} entries`,
    )
  }

  return cleaned.length > 0
    ? cleaned.slice(0, SKILL_ALLOWED_TOOLS_MAX)
    : null
}

/**
 * Claude Code keys are only defaults for the two columns the user sets:
 * a skill can never make itself model-invocable or slash-invocable. A skill
 * that turns off model invocation is user-only in Claude Code, so it becomes
 * a slash command here; without any key it stays a plain model-invocable
 * skill.
 */
function readInvocationDefaults(
  data: Record<string, unknown>,
  name: string,
  warnings: string[],
): SkillInvocationDefaults {
  const disableModelInvocation = toLenientBoolean(
    data['disable-model-invocation'],
  )
  const userInvocable = toLenientBoolean(data['user-invocable'])
  const modelInvocable = disableModelInvocation !== true
  let slashCommand = userInvocable === true
    || (userInvocable !== false && disableModelInvocation === true)

  if (slashCommand && isReservedSkillSlashName(name)) {
    slashCommand = false
    warnings.push(`/${name} is reserved by Besidka, so it is not a command`)
  }

  const argumentHint = readOptionalText(
    data['argument-hint'],
    'argument-hint',
    SKILL_ARGUMENT_HINT_MAX,
    warnings,
  )

  return { modelInvocable, slashCommand, argumentHint }
}

/**
 * Lenient YAML, strict rules: a broken scalar is retried once with loose
 * values quoted, aliases and oversized blocks are refused, and the two
 * required fields decide whether the skill is accepted at all.
 */
export function parseSkillMarkdown(text: string): ParsedSkillMarkdown {
  const split = splitSkillFrontmatter(text)

  if (!split.ok) {
    return split
  }

  if ((split.raw.match(NAME_KEY_LINE_PATTERN)?.length ?? 0) > 1) {
    return failure(
      'frontmatter-invalid',
      'The frontmatter in SKILL.md has more than one "name" key',
    )
  }

  const data = parseFrontmatterBlock(split.raw)

  if (!data) {
    return failure(
      'frontmatter-invalid',
      'The frontmatter in SKILL.md is not valid YAML',
    )
  }

  const warnings: string[] = []
  const rawName = data.name

  if (
    rawName === undefined
    || rawName === null
    || !(typeof rawName === 'string' || typeof rawName === 'number')
    || String(rawName).trim() === ''
  ) {
    return failure('name-missing', 'SKILL.md needs a "name" in its frontmatter')
  }

  const name = String(rawName).trim()

  if (!isSkillNameValid(name)) {
    return failure(
      'name-invalid',
      'The skill name must use lowercase letters, digits and single hyphens, up to 64 characters',
    )
  }

  const rawDescription = data.description

  if (
    typeof rawDescription !== 'string'
    || rawDescription.trim() === ''
  ) {
    return failure(
      'description-missing',
      'SKILL.md needs a "description" in its frontmatter',
    )
  }

  let description = rawDescription.trim()

  if (description.length > SKILL_DESCRIPTION_MAX) {
    description = description.slice(0, SKILL_DESCRIPTION_MAX)
    warnings.push(
      `"description" was cut to ${SKILL_DESCRIPTION_MAX} characters`,
    )
  }

  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key) && warnings.length < MAX_FRONTMATTER_WARNINGS) {
      warnings.push(`Unknown frontmatter key "${key.slice(0, 60)}" is kept`)
    }
  }

  return {
    ok: true,
    frontmatter: {
      name,
      description,
      license: readOptionalText(
        data.license,
        'license',
        SKILL_LICENSE_FIELD_MAX,
        warnings,
      ),
      compatibility: readOptionalText(
        data.compatibility,
        'compatibility',
        SKILL_COMPATIBILITY_MAX,
        warnings,
      ),
      metadata: readMetadata(data.metadata, warnings),
      allowedTools: readAllowedTools(data['allowed-tools'], warnings),
      defaults: readInvocationDefaults(data, name, warnings),
    },
    body: split.body,
    warnings,
  }
}

const FRONTMATTER_BLOCK_PATTERN
  = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/
const NAME_LINE_PATTERN = /^(["']?)name\1[ \t]*:[^\r\n]*$/m

/**
 * Rewrites the `name:` line of the frontmatter and leaves every other byte
 * alone, so a skill renamed at import still carries its own name in
 * SKILL.md. The new name must already be valid. Null when there is no
 * top-level `name:` line to rewrite.
 */
export function renameSkillMarkdown(
  text: string,
  name: string,
): string | null {
  const byteOrderMark = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const content = byteOrderMark ? text.slice(1) : text
  const match = FRONTMATTER_BLOCK_PATTERN.exec(content)

  if (!match) {
    return null
  }

  const [, opening, block, closing] = match

  if (!NAME_LINE_PATTERN.test(block!)) {
    return null
  }

  const renamedBlock = block!.replace(NAME_LINE_PATTERN, `name: ${name}`)
  const rest = content.slice(
    opening!.length + block!.length + closing!.length,
  )

  return `${byteOrderMark}${opening}${renamedBlock}${closing}${rest}`
}
