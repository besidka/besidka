import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertAllowedGithubUrl,
  assertCommitOnRepository,
  createGithubClient,
  downloadGithubArchive,
  githubFetch,
  resolveGithubRef,
  resolveGithubSource,
} from '~~/server/utils/skills/import/github'
import { parseGithubSkillUrl } from '#shared/utils/skills/github-url'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const API = 'https://api.github.com/repos/o/r'
const OPTIONS = {
  purpose: 'skills-github' as const,
  accept: 'application/json',
  maxResponseBytes: 1024,
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function fetchOf(handler: Handler) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    return await handler(String(url), init ?? {})
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

function text(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { status, headers })
}

function json(body: unknown, status = 200) {
  return text(JSON.stringify(body), status)
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as {
      status: number
      code?: string
      message: string
      fix?: string
    }
  }

  throw new Error('Expected a rejection')
}

function parsed(url: string) {
  const result = parseGithubSkillUrl(url)

  if (!result.ok) {
    throw new Error(result.message)
  }

  return result.value
}

afterEach(() => {
  vi.useRealTimers()
})

describe('assertAllowedGithubUrl', () => {
  it('accepts exactly api.github.com and codeload.github.com over https', () => {
    expect(assertAllowedGithubUrl(`${API}/commits/main`).hostname)
      .toBe('api.github.com')
    expect(assertAllowedGithubUrl(`https://codeload.github.com/o/r/zip/${SHA}`)
      .hostname).toBe('codeload.github.com')
  })

  it.each([
    ['a host outside the allowlist', 'https://evil.example.com/o/r'],
    ['github.com itself', `https://github.com/o/r/archive/${SHA}.zip`],
    ['a lookalike host', 'https://api.github.com.evil.test/repos/o/r'],
    ['raw.githubusercontent.com', 'https://raw.githubusercontent.com/o/r/a'],
    ['plain http', 'http://api.github.com/repos/o/r'],
    ['credentials', 'https://user:pw@api.github.com/repos/o/r'],
    ['a port', 'https://api.github.com:8443/repos/o/r'],
    ['an IP literal', 'https://140.82.112.5/repos/o/r'],
    ['garbage', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertAllowedGithubUrl(url)).toThrowError(
      expect.objectContaining({ code: 'github-host-not-allowed', status: 400 }),
    )
  })
})

describe('githubFetch', () => {
  it('never calls the network for a host outside the allowlist', async () => {
    const fetchImpl = fetchOf(() => text('x'))

    const failure = await failureOf(githubFetch(
      'https://evil.example.com/x',
      { ...OPTIONS, fetchImpl },
    ))

    expect(failure.code).toBe('github-host-not-allowed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never calls the network over plain http', async () => {
    const fetchImpl = fetchOf(() => text('x'))

    const failure = await failureOf(githubFetch(
      'http://api.github.com/repos/o/r',
      { ...OPTIONS, fetchImpl },
    ))

    expect(failure.code).toBe('github-host-not-allowed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends a User-Agent, manual redirects and no credential', async () => {
    const fetchImpl = fetchOf(() => text('ok'))

    await githubFetch(`${API}/commits/main`, { ...OPTIONS, fetchImpl })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)

    expect(init.redirect).toBe('manual')
    expect(init.method).toBe('GET')
    expect(headers.get('user-agent')).toMatch(/^Besidka-Skills\//)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('x-github-api-version')).toBeTruthy()
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
    expect(init.credentials).toBeUndefined()
  })

  it('treats any redirect as an error and never follows it', async () => {
    const fetchImpl = fetchOf(() => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data' },
      })
    })

    const failure = await failureOf(githubFetch(
      'https://codeload.github.com/o/r/zip/main',
      { ...OPTIONS, fetchImpl },
    ))

    expect(failure.code).toBe('github-redirect')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats an opaque redirect response as an error too', async () => {
    const opaque = new Response(null, { status: 200 })

    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' })
    const fetchImpl = fetchOf(() => opaque)

    expect((await failureOf(githubFetch(
      `${API}/commits/main`,
      { ...OPTIONS, fetchImpl },
    ))).code).toBe('github-redirect')
  })

  it.each([403, 429])('maps %i to the rate limit message', async (status) => {
    const failure = await failureOf(githubFetch(
      `${API}/commits/main`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', status)) },
    ))

    expect(failure).toMatchObject({
      status: 429,
      message: 'GitHub rate limit reached',
      fix: 'Try again in an hour or upload a zip',
    })
  })

  it('returns 404 and 422 to the caller and errors on 5xx and others', async () => {
    expect(await githubFetch(
      `${API}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 404)) },
    )).toMatchObject({ status: 404 })
    expect(await githubFetch(
      `${API}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 422)) },
    )).toMatchObject({ status: 422 })
    expect((await failureOf(githubFetch(
      `${API}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 503)) },
    ))).status).toBe(502)
    expect((await failureOf(githubFetch(
      `${API}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 400)) },
    ))).code).toBe('github-unexpected-response')
  })

  it('refuses a declared Content-Length over the cap before reading', async () => {
    const failure = await failureOf(githubFetch(
      `${API}/x`,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          return text('x', 200, { 'content-length': '999999' })
        }),
      },
    ))

    expect(failure).toMatchObject({ status: 413, code: 'github-too-large' })
  })

  it('stops a streamed body that outgrows the cap without a length header', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(400))
      },
    })
    const failure = await failureOf(githubFetch(
      `${API}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => new Response(stream)) },
    ))

    expect(failure).toMatchObject({ status: 413, code: 'github-too-large' })
    expect(pulled).toBeLessThan(10)
  })

  it('catches an oversize archive that lies about its size', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(30 * 1024 * 1024))
        controller.close()
      },
    })

    const failure = await failureOf(githubFetch(
      `https://codeload.github.com/o/r/zip/${SHA}`,
      {
        ...OPTIONS,
        maxResponseBytes: 25 * 1024 * 1024,
        fetchImpl: fetchOf(() => {
          return new Response(stream, { headers: { 'content-length': '10' } })
        }),
      },
    ))

    expect(failure.code).toBe('github-too-large')
  })

  it('times out when GitHub does not answer', async () => {
    vi.useFakeTimers()

    const fetchImpl = fetchOf((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    const pending = failureOf(githubFetch(
      `${API}/x`,
      { ...OPTIONS, timeoutMs: 1000, fetchImpl },
    ))

    await vi.advanceTimersByTimeAsync(1001)

    expect(await pending).toMatchObject({ status: 502, code: 'github-timeout' })
  })

  it('times out while the body is still streaming', async () => {
    vi.useFakeTimers()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10))
      },
      pull() {
        return new Promise(() => undefined)
      },
    })
    const pending = failureOf(githubFetch(
      `${API}/x`,
      {
        ...OPTIONS,
        timeoutMs: 1000,
        fetchImpl: fetchOf(() => new Response(stream)),
      },
    ))

    await vi.advanceTimersByTimeAsync(1001)

    expect(await pending).toMatchObject({ code: 'github-timeout' })
  })

  it('reports a network failure as unreachable', async () => {
    const failure = await failureOf(githubFetch(
      `${API}/x`,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          throw new TypeError('network down')
        }),
      },
    ))

    expect(failure).toMatchObject({ status: 502, code: 'github-unreachable' })
  })
})

describe('resolveGithubRef', () => {
  it('reads the SHA with the sha media type and encodes a ref with slashes', async () => {
    const fetchImpl = fetchOf(() => text(`${SHA}\n`))
    const client = createGithubClient({ fetchImpl })

    expect(await resolveGithubRef(client, {
      owner: 'o',
      repo: 'r',
      ref: 'feature/x',
    })).toEqual({ found: true, sha: SHA })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${API}/commits/feature/x`)
    expect(new Headers(init.headers).get('accept'))
      .toBe('application/vnd.github.sha')
  })

  it('answers 422 as a missing ref and 404 as a missing repository', async () => {
    const missingRef = createGithubClient({ fetchImpl: fetchOf(() => text('', 422)) })
    const missingRepo = createGithubClient({ fetchImpl: fetchOf(() => text('', 404)) })

    expect(await resolveGithubRef(missingRef, { owner: 'o', repo: 'r', ref: 'x' }))
      .toEqual({ found: false, status: 422 })
    expect((await failureOf(resolveGithubRef(
      missingRepo,
      { owner: 'o', repo: 'r', ref: 'x' },
    )))).toMatchObject({
      status: 404,
      message: 'Private or missing repository',
    })
  })

  it('refuses a body that is not a commit SHA', async () => {
    const client = createGithubClient({ fetchImpl: fetchOf(() => text('<html>')) })

    expect((await failureOf(resolveGithubRef(
      client,
      { owner: 'o', repo: 'r', ref: 'main' },
    ))).code).toBe('github-unexpected-response')
  })
})

describe('assertCommitOnRepository (K18)', () => {
  function repoAndCompare(status: string | null, compareStatus = 200) {
    return fetchOf((url) => {
      if (url === API) {
        return json({ default_branch: 'main' })
      }

      return status === null
        ? text('', compareStatus)
        : json({ status, commits: [], files: [] }, compareStatus)
    })
  }

  it.each(['behind', 'identical'])('passes a commit that is %s', async (state) => {
    const fetchImpl = repoAndCompare(state)

    await expect(assertCommitOnRepository(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: SHA },
    )).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls.map((call) => {
      return call[0]
    })).toEqual([API, `${API}/compare/main...${SHA}?per_page=1`])
  })

  it.each(['ahead', 'diverged'])('rejects a commit that is %s', async (state) => {
    const failure = await failureOf(assertCommitOnRepository(
      createGithubClient({ fetchImpl: repoAndCompare(state) }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))

    expect(failure).toMatchObject({
      status: 422,
      message: 'This commit is not on any branch of o/r',
    })
  })

  it('rejects a commit GitHub cannot compare (a fork-only commit)', async () => {
    const failure = await failureOf(assertCommitOnRepository(
      createGithubClient({ fetchImpl: repoAndCompare(null, 404) }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))

    expect(failure.code).toBe('github-commit-not-on-repository')
  })

  it('rejects an oversize compare answer with the same message', async () => {
    const fetchImpl = fetchOf((url) => {
      return url === API
        ? json({ default_branch: 'main' })
        : text('x', 200, { 'content-length': String(10 * 1024 * 1024) })
    })

    expect((await failureOf(assertCommitOnRepository(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))).code).toBe('github-commit-not-on-repository')
  })

  it('reads the default branch once per import', async () => {
    const fetchImpl = repoAndCompare('identical')
    const client = createGithubClient({ fetchImpl })

    await assertCommitOnRepository(client, { owner: 'o', repo: 'r', sha: SHA })
    await assertCommitOnRepository(client, { owner: 'o', repo: 'r', sha: OTHER_SHA })

    expect(fetchImpl.mock.calls.filter((call) => {
      return call[0] === API
    })).toHaveLength(1)
  })

  it('refuses a default branch name that is not a plain ref', async () => {
    const fetchImpl = fetchOf(() => json({ default_branch: 'a b/../c' }))

    expect((await failureOf(assertCommitOnRepository(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))).code).toBe('github-unexpected-response')
  })

  it('answers a missing repository on the default branch call', async () => {
    const fetchImpl = fetchOf(() => text('', 404))

    expect((await failureOf(assertCommitOnRepository(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))).status).toBe(404)
  })
})

describe('resolveGithubSource', () => {
  it('resolves a bare repository through HEAD with one call', async () => {
    const fetchImpl = fetchOf(() => text(SHA))
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r'),
    )

    expect(source).toEqual({ sha: SHA, ref: 'HEAD', path: null })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${API}/commits/HEAD`)
  })

  it('tries splits shortest first and stops at the first existing ref', async () => {
    const fetchImpl = fetchOf((url) => {
      return url.endsWith('/commits/feature/x') ? text(SHA) : text('', 422)
    })
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r/tree/feature/x/skills/a'),
    )

    expect(source).toEqual({ sha: SHA, ref: 'feature/x', path: 'skills/a' })
    expect(fetchImpl.mock.calls.map((call) => {
      return call[0]
    })).toEqual([`${API}/commits/feature`, `${API}/commits/feature/x`])
  })

  it('makes at most three ref calls, then reports the ref as missing', async () => {
    const fetchImpl = fetchOf(() => text('', 422))
    const failure = await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r/tree/a/b/c/d/e'),
    ))

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(failure).toMatchObject({ code: 'github-ref-not-found', status: 404 })
  })

  it('stops at the first 404 because the repository is missing', async () => {
    const fetchImpl = fetchOf(() => text('', 404))
    const failure = await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r/tree/a/b/c'),
    ))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(failure.message).toBe('Private or missing repository')
  })

  it('checks a 40-character SHA from the link against the default branch', async () => {
    const fetchImpl = fetchOf((url) => {
      return url === API
        ? json({ default_branch: 'main' })
        : json({ status: 'behind' })
    })
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed(`github.com/o/r/commit/${SHA}`),
    )

    expect(source).toEqual({ sha: SHA, ref: SHA, path: null })
    expect(fetchImpl.mock.calls.map((call) => {
      return call[0]
    })).toEqual([API, `${API}/compare/main...${SHA}?per_page=1`])
  })

  it('rejects a SHA from the link that is on a fork only', async () => {
    const fetchImpl = fetchOf((url) => {
      return url === API ? json({ default_branch: 'main' }) : text('', 404)
    })

    expect((await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed(`github.com/o/r/tree/${SHA}/skills/a`),
    ))).code).toBe('github-commit-not-on-repository')
  })

  it('also checks an abbreviated SHA that resolved to a commit', async () => {
    const fetchImpl = fetchOf((url) => {
      if (url.endsWith('/commits/aaaaaaa')) {
        return text(SHA)
      }

      return url === API ? json({ default_branch: 'main' }) : text('', 404)
    })

    expect((await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r/tree/aaaaaaa/skills/a'),
    ))).code).toBe('github-commit-not-on-repository')
  })

  it('does not check a branch the API resolved', async () => {
    const fetchImpl = fetchOf(() => text(OTHER_SHA))
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl }),
      parsed('github.com/o/r/tree/main/skills/a'),
    )

    expect(source.sha).toBe(OTHER_SHA)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('lets a picked path replace the one in the link', async () => {
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: fetchOf(() => text(SHA)) }),
      parsed('github.com/o/r/tree/main/skills'),
      { path: 'skills/a' },
    )

    expect(source.path).toBe('skills/a')
  })
})

describe('downloadGithubArchive', () => {
  it('downloads only from codeload.github.com by SHA', async () => {
    const fetchImpl = fetchOf(() => text('PK'))

    const bytes = await downloadGithubArchive(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: SHA },
    )

    expect(bytes).toEqual(new TextEncoder().encode('PK'))
    expect(fetchImpl.mock.calls[0]![0])
      .toBe(`https://codeload.github.com/o/r/zip/${SHA}`)
  })

  it('refuses a ref that is not a full SHA without calling out', async () => {
    const fetchImpl = fetchOf(() => text('PK'))

    await failureOf(downloadGithubArchive(
      createGithubClient({ fetchImpl }),
      { owner: 'o', repo: 'r', sha: 'main' },
    ))

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('answers a private or missing repository on 404', async () => {
    expect((await failureOf(downloadGithubArchive(
      createGithubClient({ fetchImpl: fetchOf(() => text('', 404)) }),
      { owner: 'o', repo: 'r', sha: SHA },
    ))).message).toBe('Private or missing repository')
  })
})
