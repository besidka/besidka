export const CONNECTOR_MENTION_MIN_LENGTH = 3

const HOST_LABEL_MIN_LENGTH = 4
const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g

export interface ConnectorMentionCandidate {
  id: string
  title: string
  host: string
}

function escapeForRegex(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARACTERS, '\\$&')
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * The words a user may type to name a connector: its title, its host, and
 * the main label of the host (`notion` for `mcp.notion.com`). Titles shorter
 * than `CONNECTOR_MENTION_MIN_LENGTH` and host labels shorter than four
 * characters are skipped, so a one-letter title never matches.
 */
export function connectorMentionTerms(
  candidate: ConnectorMentionCandidate,
): string[] {
  const terms = new Set<string>()
  const title = candidate.title.trim()
  const host = candidate.host.trim().toLowerCase()

  if (codePointLength(title) >= CONNECTOR_MENTION_MIN_LENGTH) {
    terms.add(title.toLowerCase())
  }

  if (host) {
    terms.add(host)

    const labels = host.split('.').filter(Boolean)
    const mainLabel = labels.length >= 2 ? labels[labels.length - 2] : null

    if (mainLabel && mainLabel.length >= HOST_LABEL_MIN_LENGTH) {
      terms.add(mainLabel)
    }
  }

  return [...terms]
}

export function textMentionsTerm(text: string, term: string): boolean {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeForRegex(term)}(?![\\p{L}\\p{N}])`,
    'iu',
  )

  return pattern.test(text)
}

/**
 * The first connector, in list order, that the user's own text names as a
 * whole word and that is not on in this chat and not dismissed. Only text
 * the user typed is ever passed here, never model output or a tool result.
 */
export function findMentionedConnector<
  Candidate extends ConnectorMentionCandidate,
>(input: {
  text: string
  candidates: readonly Candidate[]
  selectedIds: readonly string[]
  dismissedIds: ReadonlySet<string>
}): Candidate | null {
  const text = input.text.trim()

  if (!text) {
    return null
  }

  return input.candidates.find((candidate) => {
    if (
      input.selectedIds.includes(candidate.id)
      || input.dismissedIds.has(candidate.id)
    ) {
      return false
    }

    return connectorMentionTerms(candidate).some((term) => {
      return textMentionsTerm(text, term)
    })
  }) ?? null
}
