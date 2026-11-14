import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import {
  SKILL_GITHUB_API_BUDGET_PER_HOUR,
  SKILL_GITHUB_API_BUDGET_PER_HOUR_WITH_TOKEN,
  SKILL_GITHUB_API_MAX_BYTES,
  SKILL_GITHUB_BRANCH_CACHE_SECONDS,
  SKILL_GITHUB_REF_CACHE_SECONDS,
  SKILL_GITHUB_REQUEST_DEADLINE_MS,
  SKILL_GITHUB_TIMEOUT_MS,
  SKILL_MAX_GITHUB_ARCHIVE_BYTES,
} from '#shared/utils/skills-policy'
import {
  GITHUB_DEFAULT_REF,
  GITHUB_FULL_SHA_PATTERN,
  GITHUB_SEGMENT_PATTERN,
  getGithubRefCandidates,
  isGithubFullSha,
  isGithubShaLikeRef,
  isReservedGithubRef,
} from '#shared/utils/skills/github-url'
import type { ParsedGithubSkillUrl } from '#shared/utils/skills/github-url'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
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
const GITHUB_INITIAL_BUFFER_BYTES = 64 * 1024
const GITHUB_BUDGET_KEY_PREFIX = 'skills-github-api-budget'
const GITHUB_BUDGET_WINDOW_SECONDS = 60 * 60
const GITHUB_CACHE_KEY_PREFIX = 'skills:github'
const ARCHIVE_BUSY_RETRY_SECONDS = 5
const PASS_THROUGH_STATUSES: ReadonlySet<number> = new Set([404, 422])
const COMMIT_ON_BRANCH_STATUSES: ReadonlySet<string> = new Set([
  'behind',
  'identical',
])

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
  token?: string
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
  token?: string
  deadlineAt: number
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

let archiveSlotBusy = false

export function createGithubClient(
  options: {
    fetchImpl?: typeof fetch
    logger?: LoggerLike
    kv?: GithubKv
    token?: string
    now?: number
  } = {},
): GithubClient {
  return {
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    kv: options.kv,
    token: options.token?.trim() || undefined,
    deadlineAt: (options.now ?? Date.now()) + SKILL_GITHUB_REQUEST_DEADLINE_MS,
    defaultBranches: new Map(),
  }
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
    why: 'The repository has no branch, tag or commit with that name',
    fix: 'Check the link, or paste the link to the folder on the default branch',
  })
}

function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))

  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`
}

function readResetSeconds(headers?: Headers): number | null {
  const reset = Number(headers?.get('x-ratelimit-reset'))

  if (!Number.isFinite(reset) || reset <= 0) {
    return null
  }

  return Math.max(0, Math.ceil(reset - Date.now() / 1000))
}

/**
 * GitHub's own quota for this server's address (or token) is spent. The
 * `x-ratelimit-reset` header says when it comes back.
 */
export function createGithubRateLimitError(
  options: { isAuthenticated?: boolean, headers?: Headers } = {},
) {
  const resetSeconds = readResetSeconds(options.headers)

  return createError({
    message: 'GitHub rate limit reached',
    status: 429,
    code: 'github-rate-limited',
    why: options.isAuthenticated
      ? 'GitHub stopped answering this server because its hourly request '
      + 'quota is spent'
      : 'GitHub allows 60 anonymous requests an hour for this server, and '
        + 'they are spent',
    fix: resetSeconds === null
      ? 'Try again in an hour or upload a zip'
      : `Try again in ${formatWait(resetSeconds)} or upload a zip`,
  })
}

/**
 * Besidka's own hourly cap on GitHub API calls is spent; GitHub was not
 * asked.
 */
export function createGithubBudgetSpentError(
  options: { max: number, retryAfterSeconds?: number | null },
) {
  return createError({
    message: 'Too many GitHub imports right now',
    status: 429,
    code: 'github-budget-spent',
    why: `This server makes at most ${options.max} GitHub requests an hour `
      + 'to stay inside GitHub\'s limit, and they are spent',
    fix: options.retryAfterSeconds
      ? `Try again in ${formatWait(options.retryAfterSeconds)} or upload a zip`
      : 'Try again in an hour or upload a zip',
  })
}

function createGithubBudgetUnavailableError() {
  return createError({
    message: 'GitHub import is unavailable right now',
    status: 503,
    code: 'github-budget-unavailable',
    why: 'The request counter could not be read, so no request was sent to '
      + 'GitHub',
    fix: 'Try again in a moment or upload a zip',
  })
}

function createGithubRefusedError() {
  return createError({
    message: 'GitHub refused the request',
    status: 502,
    code: 'github-refused',
    why: 'GitHub answered 403 without a rate limit, for example a blocked '
      + 'repository',
    fix: 'Check that the repository is public, or upload a zip',
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

function readDeclaredLength(response: Response): number | null {
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
 * followed, no credential is sent except the optional server token, which goes
 * to `api.github.com` only (never to codeload, never logged or put in an error
 * text), and the body is counted as it
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
      'github-timeout',
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
            ...(url.hostname === GITHUB_API_HOST
              ? { 'X-GitHub-Api-Version': GITHUB_API_VERSION }
              : {}),
            ...(url.hostname === GITHUB_API_HOST && options.token
              ? { Authorization: `Bearer ${options.token}` }
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

      const isQuotaSpent = response.status === 429
        || response.headers.get('x-ratelimit-remaining') === '0'

      throw isQuotaSpent
        ? createGithubRateLimitError({
          isAuthenticated: !!options.token,
          headers: response.headers,
        })
        : createGithubRefusedError()
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

function encodeGithubRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

function repositoryApiPath(repository: GithubRepository): string {
  return `https://${GITHUB_API_HOST}/repos/${repository.owner}/${repository.repo}`
}

function cacheKey(
  kind: string,
  repository: GithubRepository,
  suffix = '',
): string {
  return `${GITHUB_CACHE_KEY_PREFIX}:${kind}:${
    repository.owner.toLowerCase()
  }/${repository.repo.toLowerCase()}${suffix ? `:${suffix}` : ''}`
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
  } catch {
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
  } catch {
    return
  }
}

/**
 * GitHub's quota per IP is shared by the whole app, so API calls draw from one
 * global hourly budget in KV: 50 anonymous, 1000 with a server token. It fails
 * closed: a spent budget (`github-budget-spent`), or KV that cannot be read or
 * written (`github-budget-unavailable`), refuses the call without sending it.
 * Archive downloads do not count.
 */
async function consumeApiBudget(client: GithubClient): Promise<void> {
  if (!client.kv) {
    return
  }

  const max = client.token
    ? SKILL_GITHUB_API_BUDGET_PER_HOUR_WITH_TOKEN
    : SKILL_GITHUB_API_BUDGET_PER_HOUR

  try {
    const storage = createAuthRateLimitStorage(
      client.kv as unknown as KVNamespace,
      GITHUB_BUDGET_KEY_PREFIX,
    )
    const result = await storage.consume('global', {
      window: GITHUB_BUDGET_WINDOW_SECONDS,
      max,
    })

    if (result.allowed) {
      return
    }

    client.logger?.set({
      attributes: {
        skills: {
          github: { budgetSpent: true, authenticated: !!client.token },
        },
      },
    })

    throw createGithubBudgetSpentError({
      max,
      retryAfterSeconds: result.retryAfter,
    })
  } catch (exception) {
    if ((exception as { code?: string }).code === 'github-budget-spent') {
      throw exception
    }

    client.logger?.set({
      attributes: {
        skills: {
          github: {
            budgetFailedClosed: true,
            budgetError: exception instanceof Error
              ? exception.message
              : String(exception),
          },
        },
      },
    })

    throw createGithubBudgetUnavailableError()
  }
}

async function apiFetch(
  client: GithubClient,
  url: string,
  options: { accept: string, maxResponseBytes: number },
): Promise<GithubResponse> {
  await consumeApiBudget(client)

  return await githubFetch(url, {
    purpose: 'skills-github',
    token: client.token,
    accept: options.accept,
    maxResponseBytes: options.maxResponseBytes,
    deadlineAt: client.deadlineAt,
    fetchImpl: client.fetchImpl,
    logger: client.logger,
  })
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  const parsed = parseJson(bytes)

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}

interface GithubNamedRef {
  sha: string
  type: string
}

async function readNamedRef(
  client: GithubClient,
  input: GithubRepository & { namespace: 'heads' | 'tags', ref: string },
): Promise<GithubNamedRef | null> {
  const response = await apiFetch(
    client,
    `${repositoryApiPath(input)}/git/ref/${input.namespace}/${
      encodeGithubRef(input.ref)
    }`,
    {
      accept: 'application/vnd.github+json',
      maxResponseBytes: SKILL_GITHUB_API_MAX_BYTES,
    },
  )

  if (response.status !== 200) {
    return null
  }

  const body = parseJsonObject(response.bytes)
  const object = body?.object as Record<string, unknown> | undefined

  if (
    body?.ref !== `refs/${input.namespace}/${input.ref}`
    || typeof object?.sha !== 'string'
    || typeof object.type !== 'string'
    || !GITHUB_FULL_SHA_PATTERN.test(object.sha)
  ) {
    return null
  }

  return { sha: object.sha, type: object.type }
}

/**
 * Turns a branch, tag, `HEAD` or hex id into a commit SHA. A pull request
 * head or merge ref (`pull/N/head`) resolves through the commit lookup to a
 * commit that lives in a fork, so a name must first be confirmed as a branch
 * (`git/ref/heads/<name>`) or a tag (`git/ref/tags/<name>`) of this
 * repository; reserved namespaces are refused outright. `HEAD` is the
 * default branch, and a hex id is left to the reachability check. A lightweight
 * ref answers with its commit; an annotated tag is peeled by the commit
 * lookup. A 404 from the commit lookup is reported as a missing ref, and the
 * caller tells a missing repository from a missing ref.
 */
export async function resolveGithubRef(
  client: GithubClient,
  input: GithubRepository & { ref: string },
): Promise<GithubRefLookup> {
  if (isReservedGithubRef(input.ref)) {
    return { found: false, status: 422 }
  }

  const isNamedRef = input.ref !== GITHUB_DEFAULT_REF
    && !isGithubShaLikeRef(input.ref.toLowerCase())

  if (isNamedRef) {
    const named = await readNamedRef(client, {
      ...input,
      namespace: 'heads',
    }) ?? await readNamedRef(client, { ...input, namespace: 'tags' })

    if (!named) {
      return { found: false, status: 404 }
    }

    if (named.type === 'commit') {
      return { found: true, sha: named.sha }
    }
  }

  const response = await apiFetch(
    client,
    `${repositoryApiPath(input)}/commits/${encodeGithubRef(input.ref)}`,
    {
      accept: 'application/vnd.github.sha',
      maxResponseBytes: GITHUB_SHA_BODY_MAX_BYTES,
    },
  )

  if (response.status === 404 || response.status === 422) {
    return { found: false, status: response.status }
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
  const memoryKey = `${repository.owner}/${repository.repo}`
  const remembered = client.defaultBranches.get(memoryKey)

  if (remembered) {
    return remembered
  }

  const key = cacheKey('branch', repository)
  const cached = await readCache(client, key)

  if (cached) {
    client.defaultBranches.set(memoryKey, cached)

    return cached
  }

  const response = await apiFetch(client, repositoryApiPath(repository), {
    accept: 'application/vnd.github+json',
    maxResponseBytes: SKILL_GITHUB_API_MAX_BYTES,
  })

  if (response.status !== 200) {
    throw createGithubNotFoundError()
  }

  const branch = parseJsonObject(response.bytes)?.default_branch
  const segments = typeof branch === 'string' ? branch.split('/') : []

  if (
    segments.length === 0
    || branch === GITHUB_DEFAULT_REF
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

  client.defaultBranches.set(memoryKey, branch as string)
  await writeCache(
    client,
    key,
    branch as string,
    SKILL_GITHUB_BRANCH_CACHE_SECONDS,
  )

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
    response = await apiFetch(
      client,
      `${repositoryApiPath(input)}/compare/${
        encodeGithubRef(defaultBranch)
      }...${input.sha}?per_page=1`,
      {
        accept: 'application/vnd.github+json',
        maxResponseBytes: SKILL_GITHUB_API_MAX_BYTES,
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
 * A ref the repository really has, as a commit SHA that passed every check.
 * The verified answer is cached in KV for a minute, because the same link is
 * often tried twice (a pick list, then the choice) and every uncached lookup
 * spends the app-wide GitHub quota.
 */
export async function resolveVerifiedGithubRef(
  client: GithubClient,
  input: GithubRepository & { ref: string },
): Promise<GithubRefLookup> {
  const key = cacheKey('ref', input, input.ref)
  const cached = await readCache(client, key)

  if (cached && GITHUB_FULL_SHA_PATTERN.test(cached)) {
    return { found: true, sha: cached }
  }

  const lookup = await resolveGithubRef(client, input)

  if (!lookup.found) {
    return lookup
  }

  if (githubRefNeedsReachabilityCheck(input.ref, lookup.sha)) {
    await assertCommitOnRepository(client, { ...input, sha: lookup.sha })
  }

  await writeCache(client, key, lookup.sha, SKILL_GITHUB_REF_CACHE_SECONDS)

  return lookup
}

/**
 * Called when no ref was found: a missing repository and a missing ref both
 * answer 404 on the ref endpoints, so the repository itself is asked once.
 */
export async function throwGithubRefMissing(
  client: GithubClient,
  repository: GithubRepository,
): Promise<never> {
  await readDefaultBranch(client, repository)

  throw createGithubRefNotFoundError()
}

/**
 * Pins a link to one commit. A ref that contains `/` is tried as up to three
 * splits, shortest first. A 40-character commit id taken from the link goes
 * through the reachability check; a branch or tag is confirmed as one of the
 * repository's own by `resolveGithubRef`, which also refuses pull request
 * refs.
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

    if (isGithubFullSha(candidate.ref)) {
      await assertCommitOnRepository(client, {
        ...repository,
        sha: candidate.ref,
      })

      return { sha: candidate.ref, ref: candidate.ref, path }
    }

    const lookup = await resolveVerifiedGithubRef(client, {
      ...repository,
      ref: candidate.ref,
    })

    if (lookup.found) {
      return { sha: lookup.sha, ref: candidate.ref, path }
    }
  }

  return await throwGithubRefMissing(client, repository)
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
