export const KNOWLEDGE_EXCERPT_TAG = 'knowledge_excerpt'
export const KNOWLEDGE_EXCERPTS_BLOCK_TAG = 'project_knowledge_excerpts'

export const KNOWLEDGE_DOCUMENT_TAG = 'document'
export const KNOWLEDGE_BLOCK_TAG = 'project_knowledge'

const DELIMITER_OPENING = new RegExp(
  `<(\\s*\\/?\\s*)(${KNOWLEDGE_EXCERPT_TAG}|${KNOWLEDGE_EXCERPTS_BLOCK_TAG}`
  + `|(?:${KNOWLEDGE_DOCUMENT_TAG}|${KNOWLEDGE_BLOCK_TAG})(?![\\w-]))`,
  'gi',
)
const WHITESPACE_RUN = /\s+/g
const ATTRIBUTE_UNSAFE = /[&"<>]/g

const attributeEscapes: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
}

/**
 * Swaps the opening angle bracket of the wrapper tags, and only of those,
 * for a guillemet, so quoted document text can close neither its own
 * `<knowledge_excerpt>`, the pre-retrieval block, a full-mode `<document>`
 * nor the `<project_knowledge>` block. Matching ignores case and whitespace
 * inside the tag. Every other `<` and `>` is left untouched because the text
 * is often code.
 */
export function neutralizeKnowledgeDelimiters(text: string): string {
  return text.replace(DELIMITER_OPENING, '‹$1$2')
}

function toAttributeValue(value: string): string {
  return neutralizeKnowledgeDelimiters(value)
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .replace(ATTRIBUTE_UNSAFE, character => attributeEscapes[character]!)
}

export function toSingleLine(value: string): string {
  return neutralizeKnowledgeDelimiters(value).replace(WHITESPACE_RUN, ' ')
    .trim()
}

export function wrapKnowledgeExcerpt(input: {
  itemId: string
  path: string
  text: string
}): string {
  const openTag = `<${KNOWLEDGE_EXCERPT_TAG} item="${
    toAttributeValue(input.itemId)
  }" path="${toAttributeValue(input.path)}">`

  return `${openTag}${neutralizeKnowledgeDelimiters(input.text)}`
    + `</${KNOWLEDGE_EXCERPT_TAG}>`
}
