import { isMap, isScalar, parseDocument, stringify } from 'yaml'
import {
  normaliseSkillText,
  splitSkillFrontmatter,
} from '#shared/utils/skills/frontmatter'

export type SkillMarkdownMode = 'fields' | 'text'

export interface SkillMarkdownParts {
  mode: SkillMarkdownMode
  name: string
  description: string
  advanced: string
  body: string
  head: string
}

const FRONTMATTER_DELIMITER = '---'
const ADVANCED_KEYS_EXCLUDED = ['name', 'description'] as const

function readScalarText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
}

function textParts(text: string): SkillMarkdownParts {
  return {
    mode: 'text',
    name: '',
    description: '',
    advanced: '',
    body: text,
    head: '',
  }
}

/**
 * Splits `SKILL.md` into the editor's fields: the name, the description, the
 * rest of the frontmatter as YAML text, and the body. A file whose
 * frontmatter cannot be split into those fields (missing or unterminated
 * block, invalid or aliased YAML, a repeated key, a name or description that
 * is not plain text) comes back as one `text` part holding the whole file,
 * so a skill that no longer parses stays fixable.
 */
export function splitSkillMarkdownParts(text: string): SkillMarkdownParts {
  const normalised = normaliseSkillText(text)
  const split = splitSkillFrontmatter(normalised)

  if (!split.ok) {
    return textParts(normalised)
  }

  const document = parseDocument(split.raw, {
    uniqueKeys: true,
    prettyErrors: false,
    logLevel: 'silent',
  })

  if (
    document.errors.length > 0
    || document.warnings.length > 0
    || !isMap(document.contents)
  ) {
    return textParts(normalised)
  }

  const name = readScalarText(document.get('name'))
  const description = readScalarText(document.get('description'))
  const hasNameValue = document.has('name')
  const hasDescriptionValue = document.has('description')

  if (
    (hasNameValue && name === null)
    || (hasDescriptionValue && description === null)
    || (hasNameValue && !isScalar(document.get('name', true)))
    || (hasDescriptionValue && !isScalar(document.get('description', true)))
  ) {
    return textParts(normalised)
  }

  for (const key of ADVANCED_KEYS_EXCLUDED) {
    document.delete(key)
  }

  const advanced = document.contents.items.length > 0
    ? document.toString({ lineWidth: 0 }).trimEnd()
    : ''
  const lines = normalised.split('\n')
  const closingIndex = lines.findIndex((line, index) => {
    return index > 0 && /^---[ \t]*$/.test(line)
  })

  return {
    mode: 'fields',
    name: name ?? '',
    description: description ?? '',
    advanced,
    body: split.body,
    head: lines.slice(0, closingIndex + 1).join('\n'),
  }
}

function buildHead(parts: SkillMarkdownParts): string {
  const identity = stringify(
    { name: parts.name, description: parts.description },
    { lineWidth: 0 },
  )
  const advanced = parts.advanced.trim()
    ? `${parts.advanced.trimEnd()}\n`
    : ''

  return `${FRONTMATTER_DELIMITER}\n${identity}${advanced}`
    + FRONTMATTER_DELIMITER
}

export function areSkillMarkdownHeadsEqual(
  first: SkillMarkdownParts,
  second: SkillMarkdownParts,
): boolean {
  return first.name === second.name
    && first.description === second.description
    && first.advanced === second.advanced
}

/**
 * The text of `SKILL.md` for the editor's fields. The frontmatter of the
 * opened file is kept byte for byte until the name, description or advanced
 * YAML changes; only then is it written again, with `yaml`, never by string
 * concatenation of the values.
 */
export function composeSkillMarkdown(
  parts: SkillMarkdownParts,
  initial: SkillMarkdownParts,
): string {
  if (parts.mode === 'text') {
    return parts.body
  }

  const head = areSkillMarkdownHeadsEqual(parts, initial)
    ? initial.head
    : buildHead(parts)

  return `${head}\n${parts.body}`
}

/**
 * One catalog line as the model reads it (docs/skills.md section 5.2). One
 * function serves the token estimate and the Model view, so the number and
 * the text cannot drift apart.
 */
export function formatSkillCatalogLine(
  name: string,
  description: string,
): string {
  return `- ${name}: ${description}`
}
