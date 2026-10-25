import {
  KNOWLEDGE_LIMITS,
  getKnowledgeFileCategory,
  isIgnoredKnowledgePath,
} from '#shared/utils/project-knowledge-policy'
import { sha256Hex } from '~/utils/knowledge-hash'
import { normalizeKnowledgeRelativePath } from '~/utils/knowledge-paths'

export type KnowledgeSkipReason
  = | 'ignored-path'
    | 'gitignore'
    | 'binary'
    | 'unsupported'
    | 'too-large'
    | 'duplicate'
    | 'folder-limit'
    | 'invalid-path'

export type KnowledgeFileCategory = 'text' | 'document' | 'image'

export type KnowledgeGitignoreRule = (
  relativePath: string,
  isDirectory: boolean,
) => boolean

export interface KnowledgePlanEntry {
  file: File
  relativePath: string | null
}

export interface KnowledgeAcceptedEntry {
  file: File
  relativePath: string | null
  name: string
  category: KnowledgeFileCategory
  contentHash: string
}

export interface KnowledgeSkippedEntry {
  name: string
  relativePath: string | null
  reason: KnowledgeSkipReason
}

export interface KnowledgeUploadPlan {
  accepted: KnowledgeAcceptedEntry[]
  skipped: KnowledgeSkippedEntry[]
  totalBytes: number
}

export interface KnowledgePlanSummary {
  added: number
  skipped: number
  reasons: Array<{
    reason: KnowledgeSkipReason
    label: string
    count: number
  }>
}

export const knowledgeSkipReasonLabels: Record<KnowledgeSkipReason, string> = {
  'ignored-path': 'ignored folders and files (node_modules, lockfiles)',
  'gitignore': 'excluded by .gitignore',
  'binary': 'binary files',
  'unsupported': 'unsupported file types',
  'too-large': 'too large',
  'duplicate': 'already added',
  'folder-limit': 'over the folder limit (500 files or 20 MB)',
  'invalid-path': 'invalid file names or paths',
}

const BINARY_SNIFF_BYTES = 8 * 1024

function escapeRegexCharacter(character: string): string {
  return character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegexSource(glob: string): string {
  let source = ''
  let index = 0

  while (index < glob.length) {
    const character = glob.charAt(index)

    if (character === '*' && glob.charAt(index + 1) === '*') {
      const isFollowedBySeparator = glob.charAt(index + 2) === '/'

      source += isFollowedBySeparator ? '(?:.*/)?' : '.*'
      index += isFollowedBySeparator ? 3 : 2
      continue
    }

    if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += escapeRegexCharacter(character)
    }

    index += 1
  }

  return source
}

function createGitignoreRule(rawLine: string): KnowledgeGitignoreRule | null {
  let pattern = rawLine.replace(/\r$/, '').replace(/\s+$/, '')

  if (pattern.length === 0 || pattern.startsWith('#')) {
    return null
  }

  if (pattern.startsWith('!')) {
    return null
  }

  const isDirectoryOnly = pattern.endsWith('/')

  if (isDirectoryOnly) {
    pattern = pattern.slice(0, -1)
  }

  const isRooted = pattern.startsWith('/')

  if (isRooted) {
    pattern = pattern.slice(1)
  }

  if (pattern.length === 0) {
    return null
  }

  const isAnchored = isRooted || pattern.includes('/')
  const matcher = new RegExp(`^${globToRegexSource(pattern)}$`)

  return (relativePath, isDirectory) => {
    const segments = relativePath.split('/').filter(Boolean)

    return segments.some((_segment, segmentIndex) => {
      const isPrefixDirectory = segmentIndex < segments.length - 1
        || isDirectory

      if (isDirectoryOnly && !isPrefixDirectory) {
        return false
      }

      const subject = isAnchored
        ? segments.slice(0, segmentIndex + 1).join('/')
        : segments[segmentIndex] ?? ''

      return matcher.test(subject)
    })
  }
}

/**
 * Parses the supported .gitignore subset: comments, blank lines, `dir/`,
 * `*.ext`, `/rooted`, plain names and `*`, `?`, `**` globs. Negation (`!`)
 * lines are ignored, never applied. Each rule also matches through ancestor
 * directories, so `dist/` ignores `packages/app/dist/index.js`.
 */
export function parseSimpleGitignore(text: string): KnowledgeGitignoreRule[] {
  return text
    .split('\n')
    .map(line => createGitignoreRule(line))
    .filter((rule): rule is KnowledgeGitignoreRule => rule !== null)
}

export function isIgnoredByGitignore(
  rules: readonly KnowledgeGitignoreRule[],
  relativePath: string,
  isDirectory: boolean = false,
): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/')

  return rules.some(rule => rule(normalizedPath, isDirectory))
}

function getFileSizeLimit(category: KnowledgeFileCategory): number {
  if (category === 'text') {
    return KNOWLEDGE_LIMITS.maxTextFileBytes
  }

  return KNOWLEDGE_LIMITS.maxOriginalFileBytes
}

function toSkippedEntry(
  entry: KnowledgePlanEntry,
  reason: KnowledgeSkipReason,
): KnowledgeSkippedEntry {
  return {
    name: entry.file.name,
    relativePath: entry.relativePath,
    reason,
  }
}

function classifyEntry(
  entry: KnowledgePlanEntry,
  gitignoreRules: readonly KnowledgeGitignoreRule[],
): { category: KnowledgeFileCategory } | { reason: KnowledgeSkipReason } {
  const path = entry.relativePath ?? entry.file.name

  if (isIgnoredKnowledgePath(path)) {
    return { reason: 'ignored-path' }
  }

  if (isIgnoredByGitignore(gitignoreRules, path)) {
    return { reason: 'gitignore' }
  }

  const category = getKnowledgeFileCategory(entry.file.name)

  if (!category) {
    return { reason: 'unsupported' }
  }

  if (entry.file.size > getFileSizeLimit(category)) {
    return { reason: 'too-large' }
  }

  return { category }
}

async function hasNulByteInHead(file: File): Promise<boolean> {
  const head = await file.slice(0, BINARY_SNIFF_BYTES).arrayBuffer()

  return new Uint8Array(head).includes(0)
}

function normalizeEntryPath(
  entry: KnowledgePlanEntry,
): KnowledgePlanEntry | null {
  if (entry.relativePath === null) {
    return entry
  }

  const relativePath = normalizeKnowledgeRelativePath(entry.relativePath)

  return relativePath === null ? null : { file: entry.file, relativePath }
}

export async function planKnowledgeUpload(
  { entries, gitignoreText, existingHashes }: {
    entries: KnowledgePlanEntry[]
    gitignoreText: string
    existingHashes: Iterable<string>
  },
): Promise<KnowledgeUploadPlan> {
  const gitignoreRules = parseSimpleGitignore(gitignoreText)
  const knownHashes = new Set<string>(existingHashes)
  const isFolderUpload = entries.some(entry => entry.relativePath !== null)
  const accepted: KnowledgeAcceptedEntry[] = []
  const skipped: KnowledgeSkippedEntry[] = []
  let totalBytes = 0

  for (const rawEntry of entries) {
    const entry = normalizeEntryPath(rawEntry)

    if (!entry) {
      skipped.push(toSkippedEntry(rawEntry, 'invalid-path'))
      continue
    }

    const { file, relativePath } = entry
    const classification = classifyEntry(entry, gitignoreRules)

    if ('reason' in classification) {
      skipped.push(toSkippedEntry(entry, classification.reason))
      continue
    }

    const { category } = classification
    const name = file.name

    const exceedsFileCount = accepted.length >= KNOWLEDGE_LIMITS.maxFolderFiles
    const exceedsBytes = totalBytes + file.size
      > KNOWLEDGE_LIMITS.maxFolderBytes

    if (isFolderUpload && (exceedsFileCount || exceedsBytes)) {
      skipped.push(toSkippedEntry(entry, 'folder-limit'))
      continue
    }

    if (category === 'text' && await hasNulByteInHead(file)) {
      skipped.push(toSkippedEntry(entry, 'binary'))
      continue
    }

    const contentHash = await sha256Hex(await file.arrayBuffer())

    if (knownHashes.has(contentHash)) {
      skipped.push(toSkippedEntry(entry, 'duplicate'))
      continue
    }

    knownHashes.add(contentHash)
    totalBytes += file.size
    accepted.push({ file, relativePath, name, category, contentHash })
  }

  return { accepted, skipped, totalBytes }
}

export function summarizeKnowledgePlan(
  plan: Pick<KnowledgeUploadPlan, 'accepted' | 'skipped'>,
): KnowledgePlanSummary {
  const counts = new Map<KnowledgeSkipReason, number>()

  for (const skippedEntry of plan.skipped) {
    counts.set(
      skippedEntry.reason,
      (counts.get(skippedEntry.reason) ?? 0) + 1,
    )
  }

  const reasons = Array.from(counts, ([reason, count]) => {
    return { reason, label: knowledgeSkipReasonLabels[reason], count }
  }).sort((first, second) => second.count - first.count)

  return {
    added: plan.accepted.length,
    skipped: plan.skipped.length,
    reasons,
  }
}
