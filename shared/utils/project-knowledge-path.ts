import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'

const CONTROL_OR_SEPARATOR_PATTERN = /[\p{Cc}\u2028\u2029]/u
const PATH_SEPARATOR = '/'
const BACKSLASH = '\\'
const RELATIVE_SEGMENT_NAMES = ['.', '..']

export const KNOWLEDGE_RELATIVE_PATH_PRE_NORMALIZE_MAX_CHARS
  = KNOWLEDGE_LIMITS.maxRelativePathChars * 4

export function normalizeKnowledgeRelativePath(relativePath: string): string {
  return relativePath.normalize('NFC')
}

/**
 * Returns the first rule the already NFC-normalised path breaks, or null when
 * the path is valid. Client schemas and server handlers share this function.
 */
export function getKnowledgeRelativePathIssue(
  normalizedPath: string,
): string | null {
  if (normalizedPath.length === 0) {
    return 'Path must not be empty'
  }

  if (normalizedPath.length > KNOWLEDGE_LIMITS.maxRelativePathChars) {
    return 'Path must be at most '
      + `${KNOWLEDGE_LIMITS.maxRelativePathChars} characters`
  }

  if (CONTROL_OR_SEPARATOR_PATTERN.test(normalizedPath)) {
    return 'Path must be a single line without control characters'
  }

  if (normalizedPath.includes(BACKSLASH)) {
    return 'Path must not contain backslashes'
  }

  const segments = normalizedPath.split(PATH_SEPARATOR)

  if (segments.some(segment => segment.length === 0)) {
    return 'Path must not start or end with a slash or contain empty segments'
  }

  if (segments.some(segment => RELATIVE_SEGMENT_NAMES.includes(segment))) {
    return 'Path must not contain "." or ".." segments'
  }

  return null
}

export function parseKnowledgeRelativePath(
  relativePath: string,
): string | null {
  if (relativePath.length > KNOWLEDGE_RELATIVE_PATH_PRE_NORMALIZE_MAX_CHARS) {
    return null
  }

  const normalizedPath = normalizeKnowledgeRelativePath(relativePath)

  if (getKnowledgeRelativePathIssue(normalizedPath)) {
    return null
  }

  return normalizedPath
}

export function isValidKnowledgeRelativePath(relativePath: string): boolean {
  return parseKnowledgeRelativePath(relativePath) !== null
}
