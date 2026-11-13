export const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
export const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
export const GITHUB_FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
export const GITHUB_SHA_LIKE_PATTERN = /^[0-9a-f]{4,40}$/

export const GITHUB_URL_MAX_LENGTH = 600
export const GITHUB_REF_MAX_LENGTH = 200
export const GITHUB_PATH_MAX_LENGTH = 200
export const GITHUB_PATH_MAX_SEGMENTS = 10
export const GITHUB_REF_MAX_CANDIDATES = 3
export const GITHUB_DEFAULT_REF = 'HEAD'

const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'www.github.com',
])
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const SKILL_FILE_NAME = 'SKILL.md'
export const GITHUB_RESERVED_REF_ROOTS: ReadonlySet<string> = new Set([
  'pull',
  'refs',
  'keep-around',
  '__gh__',
])
const SPLIT_KINDS: ReadonlySet<string> = new Set(['tree', 'blob'])

export type GithubSkillUrlKind = 'repo' | 'tree' | 'blob' | 'commit'

export interface ParsedGithubSkillUrl {
  owner: string
  repo: string
  kind: GithubSkillUrlKind
  commitSha: string | null
  refAndPath: string[]
}

export interface GithubRefCandidate {
  ref: string
  path: string | null
}

export type GithubUrlParseResult
  = | { ok: true, value: ParsedGithubSkillUrl }
    | { ok: false, message: string }

function rejected(message: string): GithubUrlParseResult {
  return { ok: false, message }
}

export function isValidGithubSegment(segment: string): boolean {
  return segment !== '.'
    && segment !== '..'
    && GITHUB_SEGMENT_PATTERN.test(segment)
}

/**
 * Pull request heads, merge refs and GitHub's internal namespaces hold
 * commits that belong to forks, so they are never a branch or a tag of the
 * named repository and are refused wherever a ref is read.
 */
export function isReservedGithubRef(ref: string): boolean {
  const root = ref.split('/')[0]?.toLowerCase() ?? ''

  return GITHUB_RESERVED_REF_ROOTS.has(root)
}

export function isGithubFullSha(value: string): boolean {
  return GITHUB_FULL_SHA_PATTERN.test(value)
}

export function isGithubShaLikeRef(ref: string): boolean {
  return GITHUB_SHA_LIKE_PATTERN.test(ref)
}

export function githubRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`
}

export function githubTreeUrl(input: {
  owner: string
  repo: string
  ref: string
  path: string | null
}): string {
  const base = `${githubRepoUrl(input.owner, input.repo)}/tree/${input.ref}`

  return input.path ? `${base}/${input.path}` : base
}

/**
 * Reads a pasted GitHub link into its parts without any network call. Every
 * segment must pass a strict allowlist (`[A-Za-z0-9._-]`), so nothing the
 * user typed can reach another host, a query string or an encoded slash when
 * the URLs are built later. A ref that contains `/` cannot be told apart
 * from a path here; `getGithubRefCandidates` lists the possible splits.
 */
export function parseGithubSkillUrl(input: string): GithubUrlParseResult {
  const trimmed = input.trim()

  if (trimmed.length === 0 || trimmed.length > GITHUB_URL_MAX_LENGTH) {
    return rejected('Paste a link to a GitHub repository or folder')
  }

  const withScheme = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let url: URL

  try {
    url = new URL(withScheme)
  } catch {
    return rejected('This is not a valid link')
  }

  if (url.protocol !== 'https:') {
    return rejected('Only https links to github.com can be imported')
  }

  if (!GITHUB_HOSTS.has(url.hostname)) {
    return rejected('Only github.com links can be imported')
  }

  if (url.username || url.password || url.port) {
    return rejected('This link has credentials or a port, which is not allowed')
  }

  if (url.pathname.includes('%')) {
    return rejected('Encoded characters are not allowed in the link path')
  }

  const segments = url.pathname.split('/').filter((segment) => {
    return segment !== ''
  })
  const [owner, rawRepo, kind, ...rest] = segments

  if (!owner || !rawRepo) {
    return rejected('The link must name an owner and a repository')
  }

  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo

  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    return rejected('The repository owner name is not valid')
  }

  if (!isValidGithubSegment(repo) || !GITHUB_REPO_PATTERN.test(repo)) {
    return rejected('The repository name is not valid')
  }

  if (!kind) {
    return {
      ok: true,
      value: { owner, repo, kind: 'repo', commitSha: null, refAndPath: [] },
    }
  }

  if (kind === 'commit') {
    const [sha, ...extra] = rest
    const lowered = sha?.toLowerCase() ?? ''

    if (!isGithubFullSha(lowered) || extra.length > 0) {
      return rejected('Use the full 40-character commit SHA')
    }

    return {
      ok: true,
      value: {
        owner,
        repo,
        kind: 'commit',
        commitSha: lowered,
        refAndPath: [],
      },
    }
  }

  if (!SPLIT_KINDS.has(kind)) {
    return rejected(
      'Use a link to the repository, a folder (tree), a SKILL.md (blob) or a commit',
    )
  }

  if (rest.length === 0 || !rest.every(isValidGithubSegment)) {
    return rejected('The branch, tag or folder in the link is not valid')
  }

  if (
    rest.length > GITHUB_PATH_MAX_SEGMENTS + GITHUB_REF_MAX_CANDIDATES
    || rest.join('/').length > GITHUB_REF_MAX_LENGTH + GITHUB_PATH_MAX_LENGTH
  ) {
    return rejected('The path in the link is too long')
  }

  if (isReservedGithubRef(rest[0]!)) {
    return rejected(
      'Pull request and internal refs cannot be imported; use a branch, a tag or a commit of the default branch',
    )
  }

  if (kind === 'blob') {
    if (rest.length < 2 || rest.at(-1) !== SKILL_FILE_NAME) {
      return rejected('A file link must point to a SKILL.md')
    }
  }

  return {
    ok: true,
    value: {
      owner,
      repo,
      kind: kind as GithubSkillUrlKind,
      commitSha: null,
      refAndPath: rest,
    },
  }
}

function isPathWithinLimits(path: string | null): boolean {
  if (path === null) {
    return true
  }

  return path.length <= GITHUB_PATH_MAX_LENGTH
    && path.split('/').length <= GITHUB_PATH_MAX_SEGMENTS
}

/**
 * The ways a link can split into a ref and a folder, shortest ref first and
 * at most three. A branch named `feature/x` makes `tree/feature/x/skills`
 * ambiguous, so the caller tries each split against the GitHub API in this
 * order and takes the first ref that exists. A full SHA never contains `/`,
 * so it has exactly one split.
 */
export function getGithubRefCandidates(
  parsed: ParsedGithubSkillUrl,
): GithubRefCandidate[] {
  if (parsed.kind === 'repo') {
    return [{ ref: GITHUB_DEFAULT_REF, path: null }]
  }

  if (parsed.kind === 'commit') {
    return [{ ref: parsed.commitSha!, path: null }]
  }

  const segments = parsed.kind === 'blob'
    ? parsed.refAndPath.slice(0, -1)
    : parsed.refAndPath
  const lowered = segments[0]?.toLowerCase() ?? ''
  const maxRefSegments = isGithubFullSha(lowered)
    ? 1
    : Math.min(GITHUB_REF_MAX_CANDIDATES, segments.length)
  const candidates: GithubRefCandidate[] = []

  for (let refSegments = 1; refSegments <= maxRefSegments; refSegments++) {
    const ref = segments.slice(0, refSegments).join('/')
    const pathText = segments.slice(refSegments).join('/')
    const path = pathText === '' ? null : pathText

    if (
      ref.length > GITHUB_REF_MAX_LENGTH
      || !isPathWithinLimits(path)
      || isReservedGithubRef(ref)
    ) {
      continue
    }

    candidates.push({
      ref: isGithubFullSha(ref.toLowerCase()) ? ref.toLowerCase() : ref,
      path,
    })
  }

  return candidates
}
