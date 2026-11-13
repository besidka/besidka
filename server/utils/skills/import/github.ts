import { createError } from 'evlog'
import {
  SKILL_GITHUB_API_MAX_BYTES,
  SKILL_GITHUB_TIMEOUT_MS,
  SKILL_MAX_GITHUB_ARCHIVE_BYTES,
} from '#shared/utils/skills-policy'
import {
  GITHUB_FULL_SHA_PATTERN,
  GITHUB_SEGMENT_PATTERN,
  getGithubRefCandidates,
  isGithubFullSha,
  isGithubShaLikeRef,
} from '#shared/utils/skills/github-url'
import type { ParsedGithubSkillUrl } from '#shared/utils/skills/github-url'
import type { LoggerLike } from '~~/server/utils/files/logger'

export const GITHUB_API_HOST = 'api.github.com'
export const GITHUB_CODELOAD_HOST = 'codeload.github.com'
export const GITHUB_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_API_HOST,
  GITHUB_CODELOAD_HOST,
])

const GITHUB_USER_AGENT = 'Besidka-Skills/1.0'
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_SHA_BODY_MAX_BYTES = 256
const PASS_THROUGH_STATUSES: ReadonlySet<number> = new Set([404, 422])
const COMMIT_ON_BRANCH_STATUSES: ReadonlySet<string> = new Set([
  'behind',
  'identical',
])

export type GithubFetchPurpose = 'skills-github'

export interface GithubFetchOptions {
  purpose: GithubFetchPurpose
  accept: string
  maxResponseBytes: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  logger?: LoggerLike
}

export interface GithubResponse {
  status: number
  bytes: Uint8Array
}

export interface GithubClient {
  fetchImpl?: typeof fetch
  logger?: LoggerLike
  defaultBranches: Map<string, string>
}

export interface GithubRepository {
  owner: string
  repo: string
}

export interface GithubResolvedSource {
  sha: string
  ref: string
  path: string | null
}

export type GithubRefLookup
  = | { found: true, sha: string }
    | { found: false, status: number }

export function createGithubClient(
  options: { fetchImpl?: typeof fetch, logger?: LoggerLike } = {},
): GithubClient {
  return { ...options, defaultBranches: new Map() }
}

export function createGithubNotFoundError() {
  return createError({
    message: 'Private or missing repository',
    status: 404,
    code: 'github-not-found',
    why: 'GitHub answered 404, and only public repositories can be imported',
    fix: 'Check the link, make sure the repository is public, or upload a zip',
  })
}

export function createGithubRefNotFoundError() {
  return createError({
    message: 'Branch, tag or commit not found',
    status: 404,
    code: 'github-ref-not-found',
    why: 'GitHub has no commit for the branch, tag or commit in the link',
    fix: 'Check the link, or paste the link to the folder on the default branch',
  })
}

function createGithubRateLimitError() {
  return createError({
    message: 'GitHub rate limit reached',
    status: 429,
    code: 'github-rate-limited',
    why: 'GitHub allows 60 anonymous requests an hour for this server',
    fix: 'Try again in an hour or upload a zip',
  })
}

function createGithubUnavailableError(why: string, code: string) {
  return createError({
    message: 'GitHub did not answer as expected',
    status: 502,
    code,
    why,
    fix: 'Try again later or upload a zip',
  })
}

function createCommitNotOnRepositoryError(input: GithubRepository) {
  return createError({
    message: `This commit is not on any branch of ${input.owner}/${input.repo}`,
    status: 422,
    code: 'github-commit-not-on-repository',
    why: 'A commit id can belong to a fork and still resolve under another '
      + 'repository, so only commits reachable from the default branch are '
      + 'imported',
    fix: 'Use a link to a branch, a tag or a commit of the default branch',
  })
}

export function createGithubTooLargeError(limitBytes: number) {
  return createError({
    message: 'This repository is too large to import',
    status: 413,
    code: 'github-too-large',
    why: `GitHub sent more than ${limitBytes / 1024 / 1024} MiB`,
    fix: 'Upload a zip of the skill folder instead',
  })
}

/**
 * The only places a skills import may talk to. The host is never taken from
 * user input, so this guard protects against a future caller, not a user.
 */
export function assertAllowedGithubUrl(input: string): URL {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw createError({
      message: 'This address is not allowed',
      status: 400,
      code: 'github-host-not-allowed',
      why: 'The address is not a valid URL',
      fix: 'Use a github.com link',
    })
  }

  if (
    url.protocol !== 'https:'
    || !GITHUB_ALLOWED_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.port
  ) {
    throw createError({
      message: 'This address is not allowed',
      status: 400,
      code: 'github-host-not-allowed',
      why: 'Only https requests to api.github.com and codeload.github.com '
        + 'are made',
      fix: 'Use a github.com link',
    })
  }

  return url
}

async function readCappedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  aborted: Promise<never>,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)

    throw createGithubTooLargeError(maxBytes)
  }

  if (!response.body) {
    return new Uint8Array()
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])

      if (done) {
        break
      }

      total += value.byteLength

      if (total > maxBytes) {
        throw createGithubTooLargeError(maxBytes)
      }

      chunks.push(value)

      if (signal.aborted) {
        throw signal.reason
      }
    }
  } catch (exception) {
    await reader.cancel().catch(() => undefined)

    throw exception
  }

  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

/**
 * The narrow GitHub fetcher of docs/skills.md section 3.1. It keeps the call
 * shape of the later `safeFetch` (a `purpose`, a body cap, a timeout) so that
 * swapping it is one line. https only, an exact two-host allowlist, no
 * redirect is ever followed, no credential of any kind is sent, and the body
 * is counted as it streams rather than trusted from `Content-Length`.
 * 404 and 422 are returned to the caller, which knows what they mean; every
 * other non-2xx status is an error.
 */
export async function githubFetch(
  input: string,
  options: GithubFetchOptions,
): Promise<GithubResponse> {
  const url = assertAllowedGithubUrl(input)
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? SKILL_GITHUB_TIMEOUT_MS
  const timeoutError = new Error('GitHub timed out')
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(timeoutError)
    }, { once: true })
  })
  const timer = setTimeout(() => {
    controller.abort(timeoutError)
  }, timeoutMs)
  const fetchImpl = options.fetchImpl ?? fetch

  aborted.catch(() => undefined)

  try {
    let response: Response

    try {
      response = await Promise.race([
        fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': GITHUB_USER_AGENT,
            'Accept': options.accept,
            ...(url.hostname === GITHUB_API_HOST
              ? { 'X-GitHub-Api-Version': GITHUB_API_VERSION }
              : {}),
          },
        }),
        aborted,
      ])
    } catch (exception) {
      if (exception === timeoutError) {
        throw createGithubUnavailableError(
          'GitHub did not answer in time',
          'github-timeout',
        )
      }

      throw createGithubUnavailableError(
        'GitHub could not be reached',
        'github-unreachable',
      )
    }

    options.logger?.set({
      attributes: {
        skills: {
          github: {
            purpose: options.purpose,
            host: url.hostname,
            status: response.status,
          },
        },
      },
    })

    if (
      response.type === 'opaqueredirect'
      || (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel().catch(() => undefined)

      throw createGithubUnavailableError(
        'GitHub answered with a redirect, which is never followed',
        'github-redirect',
      )
    }

    if (response.status === 403 || response.status === 429) {
      await response.body?.cancel().catch(() => undefined)

      throw createGithubRateLimitError()
    }

    if (PASS_THROUGH_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined)

      return { status: response.status, bytes: new Uint8Array() }
    }

    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined)

      throw createGithubUnavailableError(
        `GitHub answered ${response.status}`,
        'github-unexpected-response',
      )
    }

    try {
      const bytes = await readCappedBody(
        response,
        options.maxResponseBytes,
        controller.signal,
        aborted,
      )

      return { status: response.status, bytes }
    } catch (exception) {
      if (exception === timeoutError) {
        throw createGithubUnavailableError(
          'GitHub did not answer in time',
          'github-timeout',
        )
      }

      throw exception
    }
  } finally {
    clearTimeout(timer)
  }
}

function encodeGithubRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

function repositoryApiPath(repository: GithubRepository): string {
  return `https://${GITHUB_API_HOST}/repos/${repository.owner}/${repository.repo}`
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))

    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * One API call that turns a branch, tag or `HEAD` into a commit SHA. A 404
 * means the repository is missing or private; a 422 means the ref does not
 * exist, so the caller may try another split of the link.
 */
export async function resolveGithubRef(
  client: GithubClient,
  input: GithubRepository & { ref: string },
): Promise<GithubRefLookup> {
  const response = await githubFetch(
    `${repositoryApiPath(input)}/commits/${encodeGithubRef(input.ref)}`,
    {
      purpose: 'skills-github',
      accept: 'application/vnd.github.sha',
      maxResponseBytes: GITHUB_SHA_BODY_MAX_BYTES,
      fetchImpl: client.fetchImpl,
      logger: client.logger,
    },
  )

  if (response.status === 404) {
    throw createGithubNotFoundError()
  }

  if (response.status === 422) {
    return { found: false, status: 422 }
  }

  const sha = new TextDecoder().decode(response.bytes).trim()

  if (!GITHUB_FULL_SHA_PATTERN.test(sha)) {
    throw createGithubUnavailableError(
      'GitHub did not return a commit id',
      'github-unexpected-response',
    )
  }

  return { found: true, sha }
}

async function readDefaultBranch(
  client: GithubClient,
  repository: GithubRepository,
): Promise<string> {
  const cacheKey = `${repository.owner}/${repository.repo}`
  const cached = client.defaultBranches.get(cacheKey)

  if (cached) {
    return cached
  }

  const response = await githubFetch(repositoryApiPath(repository), {
    purpose: 'skills-github',
    accept: 'application/vnd.github+json',
    maxResponseBytes: SKILL_GITHUB_API_MAX_BYTES,
    fetchImpl: client.fetchImpl,
    logger: client.logger,
  })

  if (response.status !== 200) {
    throw createGithubNotFoundError()
  }

  const body = parseJsonObject(response.bytes)
  const branch = body?.default_branch
  const segments = typeof branch === 'string' ? branch.split('/') : []

  if (
    segments.length === 0
    || branch === 'HEAD'
    || !segments.every((segment) => {
      return segment !== '.'
        && segment !== '..'
        && GITHUB_SEGMENT_PATTERN.test(segment)
    })
  ) {
    throw createGithubUnavailableError(
      'GitHub returned no usable default branch',
      'github-unexpected-response',
    )
  }

  client.defaultBranches.set(cacheKey, branch as string)

  return branch as string
}

/**
 * K18: a commit id can belong to a fork and still resolve under the named
 * repository, so an id that came from the link (or that a short id resolved)
 * is accepted only when it is on the default branch: `compare` must answer
 * `behind` or `identical`. Any other answer, a 404, or a body that cannot be
 * read is the same refusal.
 */
export async function assertCommitOnRepository(
  client: GithubClient,
  input: GithubRepository & { sha: string },
): Promise<void> {
  const defaultBranch = await readDefaultBranch(client, input)
  let response: GithubResponse

  try {
    response = await githubFetch(
      `${repositoryApiPath(input)}/compare/${
        encodeGithubRef(defaultBranch)
      }...${input.sha}?per_page=1`,
      {
        purpose: 'skills-github',
        accept: 'application/vnd.github+json',
        maxResponseBytes: SKILL_GITHUB_API_MAX_BYTES,
        fetchImpl: client.fetchImpl,
        logger: client.logger,
      },
    )
  } catch (exception) {
    if ((exception as { code?: string }).code === 'github-too-large') {
      throw createCommitNotOnRepositoryError(input)
    }

    throw exception
  }

  const status = response.status === 200
    ? parseJsonObject(response.bytes)?.status
    : null

  if (typeof status !== 'string' || !COMMIT_ON_BRANCH_STATUSES.has(status)) {
    throw createCommitNotOnRepositoryError(input)
  }
}

export function githubRefNeedsReachabilityCheck(
  ref: string,
  sha: string,
): boolean {
  const lowered = ref.toLowerCase()

  return isGithubShaLikeRef(lowered) && sha.startsWith(lowered)
}

/**
 * Pins a link to one commit. A ref that contains `/` is tried as up to three
 * splits, shortest first. A 40-character commit id taken from the link, or
 * any id a hex prefix resolved to, goes through the reachability check; a
 * branch or tag resolved by the API is on the repository by construction.
 */
export async function resolveGithubSource(
  client: GithubClient,
  parsed: ParsedGithubSkillUrl,
  options: { path?: string | null } = {},
): Promise<GithubResolvedSource> {
  const repository = { owner: parsed.owner, repo: parsed.repo }
  const candidates = getGithubRefCandidates(parsed)
  let refMissing = false

  for (const candidate of candidates) {
    const path = options.path === undefined ? candidate.path : options.path

    if (isGithubFullSha(candidate.ref)) {
      await assertCommitOnRepository(client, {
        ...repository,
        sha: candidate.ref,
      })

      return { sha: candidate.ref, ref: candidate.ref, path }
    }

    const lookup = await resolveGithubRef(client, {
      ...repository,
      ref: candidate.ref,
    })

    if (!lookup.found) {
      refMissing = true

      continue
    }

    if (githubRefNeedsReachabilityCheck(candidate.ref, lookup.sha)) {
      await assertCommitOnRepository(client, { ...repository, sha: lookup.sha })
    }

    return { sha: lookup.sha, ref: candidate.ref, path }
  }

  throw refMissing
    ? createGithubRefNotFoundError()
    : createGithubNotFoundError()
}

export async function downloadGithubArchive(
  client: GithubClient,
  input: GithubRepository & { sha: string },
): Promise<Uint8Array> {
  if (!isGithubFullSha(input.sha)) {
    throw createGithubUnavailableError(
      'The commit id is not a 40-character SHA',
      'github-unexpected-response',
    )
  }

  const response = await githubFetch(
    `https://${GITHUB_CODELOAD_HOST}/${input.owner}/${input.repo}/zip/${
      input.sha
    }`,
    {
      purpose: 'skills-github',
      accept: 'application/zip',
      maxResponseBytes: SKILL_MAX_GITHUB_ARCHIVE_BYTES,
      fetchImpl: client.fetchImpl,
      logger: client.logger,
    },
  )

  if (response.status !== 200) {
    throw createGithubNotFoundError()
  }

  return response.bytes
}
