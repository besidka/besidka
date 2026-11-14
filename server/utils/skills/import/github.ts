import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import {
  SKILL_GITHUB_REF_CACHE_SECONDS,
  SKILL_GITHUB_REFS_MAX_BYTES,
  SKILL_GITHUB_REQUEST_DEADLINE_MS,
  SKILL_GITHUB_TIMEOUT_MS,
  SKILL_MAX_GITHUB_ARCHIVE_BYTES,
  SKILL_MAX_SKILL_MD_BYTES,
} from '#shared/utils/skills-policy'
import {
  GITHUB_DEFAULT_REF,
  getGithubRefCandidates,
  isGithubFullSha,
  isGithubShaLikeRef,
  isReservedGithubRef,
  isValidGithubSegment,
} from '#shared/utils/skills/github-url'
import type { ParsedGithubSkillUrl } from '#shared/utils/skills/github-url'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  GIT_REFS_SERVICE_QUERY,
  parseGitRefAdvertisement,
} from '~~/server/utils/skills/import/git-refs'
import type { GitRefAdvertisement } from '~~/server/utils/skills/import/git-refs'

export const GITHUB_WEB_HOST = 'github.com'
export const GITHUB_CODELOAD_HOST = 'codeload.github.com'
export const GITHUB_RAW_HOST = 'raw.githubusercontent.com'
export const GITHUB_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_WEB_HOST,
  GITHUB_CODELOAD_HOST,
  GITHUB_RAW_HOST,
])

const GITHUB_USER_AGENT = 'Besidka-Skills/1.0'
const GITHUB_INITIAL_BUFFER_BYTES = 64 * 1024
const GITHUB_CACHE_KEY_PREFIX = 'skills:github'
const GITHUB_REFS_PATH_PATTERN
  = /^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}\.git\/info\/refs$/
const GITHUB_REFS_ACCEPT = '*/*'
const ARCHIVE_BUSY_RETRY_SECONDS = 5
const PASS_THROUGH_STATUSES: ReadonlySet<number> = new Set([401, 404])

export type GithubFetchPurpose = 'skills-github'

export interface GithubKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
}

export interface GithubFetchOptions {
  purpose: GithubFetchPurpose
  accept: string
  maxResponseBytes: number
  timeoutMs?: number
  deadlineAt?: number
  fetchImpl?: typeof fetch
  logger?: LoggerLike
}

export interface GithubResponse {
  status: number
  bytes: Uint8Array
  headers?: Headers
}

export interface GithubClient {
  fetchImpl?: typeof fetch
  logger?: LoggerLike
  kv?: GithubKv
  deadlineAt: number
  refsByRepository: Map<string, GitRefAdvertisement>
}

export interface GithubRepository {
  owner: string
  repo: string
}

export interface GithubResolvedSource {
  sha: string
  ref: string
  path: string | null
  warnings: string[]
}

export type GithubRefLookup
  = | { found: true, sha: string }
    | { found: false }

let archiveSlotBusy = false

export function createGithubClient(
  options: {
    fetchImpl?: typeof fetch
    logger?: LoggerLike
    kv?: GithubKv
    now?: number
  } = {},
): GithubClient {
  return {
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    kv: options.kv,
    deadlineAt: (options.now ?? Date.now()) + SKILL_GITHUB_REQUEST_DEADLINE_MS,
    refsByRepository: new Map(),
  }
}

export function createGithubNotFoundError() {
  return createError({
    message: 'Private or missing repository',
    status: 404,
    code: 'github-not-found',
    why: 'GitHub did not show this repository, and only public repositories '
      + 'can be imported',
    fix: 'Check the link, make sure the repository is public, or upload a zip',
  })
}

export function createGithubRefNotFoundError() {
  return createError({
    message: 'Branch, tag or commit not found',
    status: 404,
    code: 'github-ref-not-found',
    why: 'The repository has no branch or tag with that name, and no branch '
      + 'or tag starts with that commit id',
    fix: 'Use a link with a branch, a tag or the full 40-character commit id, '
      + 'or paste the link to the folder on the default branch',
  })
}

export function createGithubRateLimitError() {
  return createError({
    message: 'GitHub rate limit reached',
    status: 429,
    code: 'github-rate-limited',
    why: 'GitHub answered that this server sent too many requests',
    fix: 'Try again in a few minutes or upload a zip',
  })
}

function createGithubRefusedError() {
  return createError({
    message: 'GitHub refused the request',
    status: 502,
    code: 'github-refused',
    why: 'GitHub answered 403, for example for a blocked repository',
    fix: 'Check that the repository is public, or upload a zip',
  })
}

function createGithubUnavailableError(
  why: string,
  code: string = 'github-unavailable',
) {
  return createError({
    message: 'GitHub did not answer as expected',
    status: 502,
    code,
    why,
    fix: 'Try again later or upload a zip',
  })
}

export function createGithubTooLargeError(limitBytes: number) {
  return createError({
    message: 'This repository is too large to import',
    status: 413,
    code: 'github-too-large',
    why: `GitHub sent more than ${limitBytes / 1024 / 1024} MiB`,
    fix: 'Download just the skill folder as a zip, then upload that zip here',
  })
}

function createGithubRefsTooLargeError() {
  return createError({
    message: 'This repository has too many branches and tags to read',
    status: 413,
    code: 'github-refs-too-large',
    why: 'The list of its branches and tags is larger than '
      + `${SKILL_GITHUB_REFS_MAX_BYTES / 1024 / 1024} MiB`,
    fix: 'Paste a link that holds the full 40-character commit id, or upload '
      + 'a zip',
  })
}

function setRetryAfterHeader(seconds: number): void {
  try {
    const event = useEvent() as unknown as RequestEvent

    event.res.headers.set('Retry-After', String(seconds))
  } catch {
    return
  }
}

function createArchiveBusyError() {
  setRetryAfterHeader(ARCHIVE_BUSY_RETRY_SECONDS)

  return createError({
    message: 'Another GitHub import is running, try again in a moment',
    status: 503,
    code: 'github-busy',
    why: 'One repository archive is processed at a time on this server, to '
      + 'stay inside the Worker memory limit',
    fix: 'Try again in a few seconds',
  })
}

/**
 * The only places a skills import may talk to: the git ref list of a public
 * repository on `github.com` (that one path and query only), the archive on
 * `codeload.github.com` and single files on `raw.githubusercontent.com`. The
 * host is never taken from user input, so this guard protects against a
 * future caller, not a user. `api.github.com` is not allowed: its anonymous
 * quota is shared by every Workers address and is already spent.
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

  const isWebPathAllowed = url.hostname !== GITHUB_WEB_HOST
    || (
      GITHUB_REFS_PATH_PATTERN.test(url.pathname)
      && url.search === `?${GIT_REFS_SERVICE_QUERY}`
    )

  if (
    url.protocol !== 'https:'
    || !GITHUB_ALLOWED_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.port
    || url.hash
    || !isWebPathAllowed
  ) {
    throw createError({
      message: 'This address is not allowed',
      status: 400,
      code: 'github-host-not-allowed',
      why: 'Only https requests for the ref list of a repository on '
        + 'github.com, the archive on codeload.github.com and files on '
        + 'raw.githubusercontent.com are made',
      fix: 'Use a github.com link',
    })
  }

  return url
}

function readDeclaredLength(response: Response): number | null {
  const encoding = response.headers.get('content-encoding')

  if (encoding && encoding.toLowerCase() !== 'identity') {
    return null
  }

  const header = response.headers.get('content-length')

  if (header === null || header.trim() === '') {
    return null
  }

  const declared = Number(header)

  return Number.isFinite(declared) && declared >= 0 ? declared : null
}

/**
 * Reads the body into one buffer: sized from `Content-Length` when GitHub
 * sends it, otherwise doubled from 64 KiB up to the cap. Chunks are copied
 * in as they arrive, so the peak is the buffer, not the buffer plus a list
 * of chunks plus a joined copy. A body that outgrows its declared length or
 * the cap is refused.
 */
async function readCappedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  aborted: Promise<never>,
): Promise<Uint8Array> {
  const declared = readDeclaredLength(response)

  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)

    throw createGithubTooLargeError(maxBytes)
  }

  if (!response.body) {
    return new Uint8Array()
  }

  const reader = response.body.getReader()
  let buffer = new Uint8Array(
    declared ?? Math.min(GITHUB_INITIAL_BUFFER_BYTES, maxBytes),
  )
  let total = 0

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])

      if (done) {
        break
      }

      const needed = total + value.byteLength

      if (needed > maxBytes || (declared !== null && needed > declared)) {
        throw createGithubTooLargeError(maxBytes)
      }

      if (needed > buffer.byteLength) {
        const grown = new Uint8Array(
          Math.min(Math.max(buffer.byteLength * 2, needed), maxBytes),
        )

        grown.set(buffer.subarray(0, total))
        buffer = grown
      }

      buffer.set(value, total)
      total = needed

      if (signal.aborted) {
        throw signal.reason
      }
    }
  } catch (exception) {
    await reader.cancel().catch(() => undefined)

    throw exception
  }

  return buffer.subarray(0, total)
}

/**
 * The narrow GitHub fetcher of docs/skills.md section 3.1. It keeps the call
 * shape of the later `safeFetch` (a `purpose`, a body cap, a timeout), but it
 * returns `{ status, bytes }` rather than a `Response`, so the swap needs a
 * small adapter. https only, an exact two-host allowlist, no redirect is ever
 * followed, no credential of any kind is sent, and the body is counted as it
 * streams rather than trusted from `Content-Length`. 404 and 422 are returned
 * to the caller, which knows what they mean; a 403 is a rate limit only when
 * GitHub says its quota is spent; every other non-2xx status is an error.
 * The per-call timeout is cut short by the request deadline, when one is set.
 */
export async function githubFetch(
  input: string,
  options: GithubFetchOptions,
): Promise<GithubResponse> {
  const url = assertAllowedGithubUrl(input)
  const remainingMs = options.deadlineAt === undefined
    ? Infinity
    : options.deadlineAt - Date.now()
  const timeoutMs = Math.min(
    options.timeoutMs ?? SKILL_GITHUB_TIMEOUT_MS,
    remainingMs,
  )

  if (timeoutMs <= 0) {
    throw createGithubUnavailableError(
      'The import took too long',
    )
  }

  const controller = new AbortController()
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
          },
        }),
        aborted,
      ])
    } catch (exception) {
      if (exception === timeoutError) {
        throw createGithubUnavailableError(
          'GitHub did not answer in time',
        )
      }

      throw createGithubUnavailableError(
        'GitHub could not be reached',
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

      throw response.status === 429
        ? createGithubRateLimitError()
        : createGithubRefusedError()
    }

    if (PASS_THROUGH_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined)

      return { status: response.status, bytes: new Uint8Array() }
    }

    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined)

      throw createGithubUnavailableError(`GitHub answered ${response.status}`)
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
        )
      }

      throw exception
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs one archive download and its extraction at a time in this isolate. A
 * repository archive and its inflated files can take most of the Worker's
 * memory, so a second import is told to retry instead of queued.
 */
export async function withGithubArchiveSlot<T>(
  task: () => Promise<T>,
): Promise<T> {
  if (archiveSlotBusy) {
    throw createArchiveBusyError()
  }

  archiveSlotBusy = true

  try {
    return await task()
  } finally {
    archiveSlotBusy = false
  }
}

function cacheKey(repository: GithubRepository): string {
  return `${GITHUB_CACHE_KEY_PREFIX}:refs:${
    repository.owner.toLowerCase()
  }/${repository.repo.toLowerCase()}`
}

async function readCache(
  client: GithubClient,
  key: string,
): Promise<string | null> {
  if (!client.kv) {
    return null
  }

  try {
    return await client.kv.get(key)
  } catch (_exception) {
    client.logger?.set({
      attributes: { skills: { github: { cacheReadFailed: true } } },
    })

    return null
  }
}

async function writeCache(
  client: GithubClient,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  if (!client.kv) {
    return
  }

  try {
    await client.kv.put(key, value, { expirationTtl: ttlSeconds })
  } catch (_exception) {
    client.logger?.set({
      attributes: { skills: { github: { cacheWriteFailed: true } } },
    })
  }
}

interface CachedAdvertisement {
  head: GitRefAdvertisement['head']
  branches: Array<[string, string]>
  tags: Array<[string, string]>
}

function serialiseAdvertisement(advertisement: GitRefAdvertisement): string {
  return JSON.stringify({
    head: advertisement.head,
    branches: [...advertisement.branches],
    tags: [...advertisement.tags],
  } satisfies CachedAdvertisement)
}

function readCachedAdvertisement(raw: string): GitRefAdvertisement | null {
  try {
    const parsed = JSON.parse(raw) as CachedAdvertisement

    if (!Array.isArray(parsed.branches) || !Array.isArray(parsed.tags)) {
      return null
    }

    return {
      head: parsed.head ?? null,
      branches: new Map(parsed.branches),
      tags: new Map(parsed.tags),
    }
  } catch (_exception) {
    return null
  }
}

/**
 * Every branch and tag of a public repository, read from the git smart HTTP
 * ref list (`github.com/<owner>/<repo>.git/info/refs`), which has no
 * per-address quota the way `api.github.com` has. Peeled tags answer with
 * their commit. A 404 or 401 means the repository is missing or private. The
 * answer is cached in KV for `SKILL_GITHUB_REF_CACHE_SECONDS`, because the
 * same link is often tried twice (a pick list, then the choice).
 */
export async function fetchGithubRefs(
  client: GithubClient,
  repository: GithubRepository,
): Promise<GitRefAdvertisement> {
  const memoryKey = `${repository.owner}/${repository.repo}`
  const remembered = client.refsByRepository.get(memoryKey)

  if (remembered) {
    return remembered
  }

  const key = cacheKey(repository)
  const cached = await readCache(client, key)
  const fromCache = cached ? readCachedAdvertisement(cached) : null

  if (fromCache) {
    client.refsByRepository.set(memoryKey, fromCache)

    return fromCache
  }

  let response: GithubResponse

  try {
    response = await githubFetch(
      `https://${GITHUB_WEB_HOST}/${repository.owner}/${
        repository.repo
      }.git/info/refs?${GIT_REFS_SERVICE_QUERY}`,
      {
        purpose: 'skills-github',
        accept: GITHUB_REFS_ACCEPT,
        maxResponseBytes: SKILL_GITHUB_REFS_MAX_BYTES,
        deadlineAt: client.deadlineAt,
        fetchImpl: client.fetchImpl,
        logger: client.logger,
      },
    )
  } catch (exception) {
    if ((exception as { code?: string }).code === 'github-too-large') {
      throw createGithubRefsTooLargeError()
    }

    throw exception
  }

  if (response.status !== 200) {
    throw createGithubNotFoundError()
  }

  const advertisement = parseGitRefAdvertisement(response.bytes)

  if (!advertisement) {
    throw createGithubUnavailableError(
      'GitHub did not send a list of branches and tags this server can read',
      'github-unexpected-response',
    )
  }

  client.refsByRepository.set(memoryKey, advertisement)
  await writeCache(
    client,
    key,
    serialiseAdvertisement(advertisement),
    SKILL_GITHUB_REF_CACHE_SECONDS,
  )

  return advertisement
}

function findShortShaMatch(
  advertisement: GitRefAdvertisement,
  prefix: string,
): string | null {
  const matches = new Set<string>()

  for (const sha of [
    ...advertisement.branches.values(),
    ...advertisement.tags.values(),
  ]) {
    if (sha.startsWith(prefix)) {
      matches.add(sha)
    }
  }

  return matches.size === 1 ? [...matches][0]! : null
}

/**
 * Turns a branch, tag, `HEAD`, full commit id or short commit id into a full
 * commit id. A full id is used as it is, with no request. `HEAD` is the
 * default branch. A name is a branch first, then a tag (a peeled tag gives
 * its commit); a short id must start exactly one branch or tag tip. Pull
 * request and internal refs are refused outright.
 */
export async function resolveGithubRef(
  client: GithubClient,
  input: GithubRepository & { ref: string },
): Promise<GithubRefLookup> {
  if (isReservedGithubRef(input.ref)) {
    return { found: false }
  }

  if (isGithubFullSha(input.ref.toLowerCase())) {
    return { found: true, sha: input.ref.toLowerCase() }
  }

  const advertisement = await fetchGithubRefs(client, input)

  if (input.ref === GITHUB_DEFAULT_REF) {
    return advertisement.head
      ? { found: true, sha: advertisement.head.sha }
      : { found: false }
  }

  const named = advertisement.branches.get(input.ref)
    ?? advertisement.tags.get(input.ref)

  if (named) {
    return { found: true, sha: named }
  }

  const lowered = input.ref.toLowerCase()
  const short = isGithubShaLikeRef(lowered)
    ? findShortShaMatch(advertisement, lowered)
    : null

  return short ? { found: true, sha: short } : { found: false }
}

async function warnWhenCommitIsNotATip(
  client: GithubClient,
  repository: GithubRepository,
  sha: string,
): Promise<string[]> {
  const warning = `GitHub cannot confirm that commit ${sha.slice(0, 7)} belongs `
    + `to ${repository.owner}/${repository.repo}: it is not the latest commit of `
    + 'a branch or a tag, and a commit of a fork can be reached under this name'

  try {
    const advertisement = await fetchGithubRefs(client, repository)
    const tips = new Set([
      ...(advertisement.head ? [advertisement.head.sha] : []),
      ...advertisement.branches.values(),
      ...advertisement.tags.values(),
    ])

    return tips.has(sha) ? [] : [warning]
  } catch (_exception) {
    client.logger?.set({
      attributes: { skills: { github: { tipCheckFailed: true } } },
    })

    return [warning]
  }
}

/**
 * Pins a link to one commit. A ref that contains `/` is tried as up to three
 * splits, shortest first. A full commit id from the link is used as it is
 * and carries a warning when it is not the tip of a branch or tag, because
 * without the API there is no way to prove it belongs to this repository.
 */
export async function resolveGithubSource(
  client: GithubClient,
  parsed: ParsedGithubSkillUrl,
  options: { path?: string | null } = {},
): Promise<GithubResolvedSource> {
  const repository = { owner: parsed.owner, repo: parsed.repo }
  const candidates = getGithubRefCandidates(parsed)

  for (const candidate of candidates) {
    const path = options.path === undefined ? candidate.path : options.path
    const lookup = await resolveGithubRef(client, {
      ...repository,
      ref: candidate.ref,
    })

    if (!lookup.found) {
      continue
    }

    const warnings = isGithubFullSha(candidate.ref)
      ? await warnWhenCommitIsNotATip(client, repository, lookup.sha)
      : []

    return { sha: lookup.sha, ref: candidate.ref, path, warnings }
  }

  await fetchGithubRefs(client, repository)

  throw createGithubRefNotFoundError()
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
      deadlineAt: client.deadlineAt,
      fetchImpl: client.fetchImpl,
      logger: client.logger,
    },
  )

  if (response.status !== 200) {
    throw createGithubNotFoundError()
  }

  return response.bytes
}

/**
 * One `SKILL.md` of a commit from `raw.githubusercontent.com`, for a link
 * that points straight at the file. `null` when the commit has no file at
 * that path.
 */
export async function fetchGithubSkillMarkdown(
  client: GithubClient,
  input: GithubRepository & { sha: string, folder: string | null },
): Promise<Uint8Array | null> {
  const segments = input.folder ? input.folder.split('/') : []

  if (
    !isGithubFullSha(input.sha)
    || !segments.every(isValidGithubSegment)
  ) {
    throw createGithubUnavailableError(
      'The file address is not valid',
      'github-unexpected-response',
    )
  }

  const response = await githubFetch(
    `https://${GITHUB_RAW_HOST}/${input.owner}/${input.repo}/${input.sha}/${
      [...segments, SKILL_MD_FILE_NAME].join('/')
    }`,
    {
      purpose: 'skills-github',
      accept: 'text/plain',
      maxResponseBytes: SKILL_MAX_SKILL_MD_BYTES,
      deadlineAt: client.deadlineAt,
      fetchImpl: client.fetchImpl,
      logger: client.logger,
    },
  )

  return response.status === 200 ? response.bytes : null
}
