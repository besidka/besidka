import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'

const CONTROL_CHARACTERS_GLOBAL_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}]/gu

const WHITESPACE_RUN_PATTERN = /\s+/g

function isHighSurrogate(character: string): boolean {
  const codeUnit = character.charCodeAt(0)

  return codeUnit >= 0xD800 && codeUnit <= 0xDBFF
}

export function normalizeKnowledgeTitle(title: string): string {
  const collapsed = title
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS_GLOBAL_PATTERN, ' ')
    .replace(WHITESPACE_RUN_PATTERN, ' ')
    .trim()
  const truncated = collapsed.slice(0, KNOWLEDGE_LIMITS.maxTitleChars)
  const lastCharacter = truncated.slice(-1)

  if (truncated.length < collapsed.length && isHighSurrogate(lastCharacter)) {
    return truncated.slice(0, -1).trim()
  }

  return truncated.trim()
}
