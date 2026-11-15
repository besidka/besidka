import { SKILL_TEMPLATE_IDS } from '#shared/utils/skills/templates'

export const OFFICIAL_SKILLS_SOURCE = 'anthropics/skills'

/**
 * The skill names of `anthropics/skills`, frozen at commit 2c5958ec. A list
 * that follows the repository would make a name that was fine yesterday a
 * lookalike today, so a new name is added by hand.
 */
export const KNOWN_SKILL_NAMES: readonly string[] = [
  'academy-guide',
  'algorithmic-art',
  'brand-guidelines',
  'canvas-design',
  'claude-api',
  'discernment-nudge',
  'doc-coauthoring',
  'docx',
  'frontend-design',
  'internal-comms',
  'mcp-builder',
  'pdf',
  'pptx',
  'skill-creator',
  'slack-gif-creator',
  'theme-factory',
  'web-artifacts-builder',
  'webapp-testing',
  'xlsx',
]

export const KNOWN_SKILL_OWNERS: readonly string[] = [
  'anthropics',
  'openai',
  'vercel-labs',
  'vercel',
  'cloudflare',
  'trailofbits',
  'microsoft',
  'google',
  'github',
  'huggingface',
  'langchain-ai',
  'supabase',
  'stripe',
]

const SHORT_NAME_LENGTH = 6

/**
 * Damerau-Levenshtein distance with adjacent transpositions (the optimal
 * string alignment form), stopping early once it passes `limit`.
 */
export function measureEditDistance(
  left: string,
  right: string,
  limit: number,
): number {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1
  }

  const rows: number[][] = []

  for (let row = 0; row <= left.length; row++) {
    rows.push(Array.from({ length: right.length + 1 }, (_, column) => {
      return row === 0 ? column : column === 0 ? row : 0
    }))
  }

  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1

      rows[row]![column] = Math.min(
        rows[row - 1]![column]! + 1,
        rows[row]![column - 1]! + 1,
        rows[row - 1]![column - 1]! + cost,
      )

      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        rows[row]![column] = Math.min(
          rows[row]![column]!,
          rows[row - 2]![column - 2]! + 1,
        )
      }
    }
  }

  return rows[left.length]![right.length]!
}

/**
 * The known name that `candidate` is close to without being equal to it: one
 * edit away for names of up to six characters, two for longer ones. Case is
 * ignored. An exact match, which is the well-known skill itself, gives null.
 */
export function findLookalikeName(
  candidate: string,
  knownNames: readonly string[],
): string | null {
  const lowered = candidate.toLowerCase()

  if (knownNames.some((known) => {
    return known.toLowerCase() === lowered
  })) {
    return null
  }

  let closest: { name: string, distance: number } | null = null

  for (const known of knownNames) {
    const knownLowered = known.toLowerCase()
    const limit = Math.min(lowered.length, knownLowered.length)
      <= SHORT_NAME_LENGTH
      ? 1
      : 2
    const distance = measureEditDistance(lowered, knownLowered, limit)

    if (distance <= limit && (!closest || distance < closest.distance)) {
      closest = { name: known, distance }
    }
  }

  return closest?.name ?? null
}

export function getKnownSkillNames(
  otherSkillNames: readonly string[] = [],
): string[] {
  return [
    ...KNOWN_SKILL_NAMES,
    ...SKILL_TEMPLATE_IDS,
    ...otherSkillNames,
  ]
}

export function isOfficialSkillsSource(source: string | null): boolean {
  return source?.toLowerCase() === OFFICIAL_SKILLS_SOURCE
}

export function splitGithubSource(
  source: string | null,
): { owner: string, repo: string } | null {
  const parts = source?.split('/') ?? []

  return parts.length === 2 && parts[0] && parts[1]
    ? { owner: parts[0], repo: parts[1] }
    : null
}
