import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertAllowedGithubUrl,
  assertCommitOnRepository,
  createGithubClient,
  downloadGithubArchive,
  githubFetch,
} from '~~/server/utils/skills/import/github'

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

  it('sends the server token to api.github.com only, never to codeload', async () => {
    const fetchImpl = fetchOf(() => json({}))
    const logger = { set: vi.fn() }

    await githubFetch(`${API}/commits/main`, {
      ...OPTIONS,
      token: 'secret-token',
      fetchImpl,
      logger,
    })
    await githubFetch(`https://codeload.github.com/o/r/zip/${SHA}`, {
      ...OPTIONS,
      token: 'secret-token',
      fetchImpl,
      logger,
    })

    const apiHeaders = new Headers(fetchImpl.mock.calls[0]![1].headers)
    const codeloadHeaders = new Headers(fetchImpl.mock.calls[1]![1].headers)

    expect(apiHeaders.get('authorization')).toBe('Bearer secret-token')
    expect(codeloadHeaders.has('authorization')).toBe(false)
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('secret-token')
  })

  it('sends no Authorization header without a token', async () => {
    const fetchImpl = fetchOf(() => json({}))

    await githubFetch(`${API}/commits/main`, { ...OPTIONS, fetchImpl })

    expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has('authorization'))
      .toBe(false)
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

  it('maps 429 and a 403 with a spent quota to the rate limit message', async () => {
    const spent = { 'x-ratelimit-remaining': '0' }

    for (const response of [
      () => text('', 429),
      () => text('', 403, spent),
    ]) {
      const failure = await failureOf(githubFetch(
        `${API}/commits/main`,
        { ...OPTIONS, fetchImpl: fetchOf(response) },
      ))

      expect(failure).toMatchObject({
        status: 429,
        message: 'GitHub rate limit reached',
        fix: 'Try again in an hour or upload a zip',
      })
    }
  })

  it('says when GitHub quota comes back and whether the server is signed in', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 25 * 60)
    const spent = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }
    const anonymous = await failureOf(githubFetch(
      `${API}/commits/main`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 403, spent)) },
    ))
    const signedIn = await failureOf(githubFetch(
      `${API}/commits/main`,
      {
        ...OPTIONS,
        token: 'tok',
        fetchImpl: fetchOf(() => text('', 403, spent)),
      },
    ))

    expect(anonymous).toMatchObject({
      code: 'github-rate-limited',
      why: expect.stringContaining('60 anonymous requests'),
      fix: expect.stringMatching(/about 2[56] minutes/),
    })
    expect(signedIn.why).toContain('hourly request quota')
    expect(JSON.stringify([anonymous, signedIn])).not.toContain('tok"')
  })

  it('does not call a plain 403 a rate limit', async () => {
    const failure = await failureOf(githubFetch(
      `${API}/commits/main`,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          return text('', 403, { 'x-ratelimit-remaining': '41' })
        }),
      },
    ))

    expect(failure).toMatchObject({
      status: 502,
      message: 'GitHub refused the request',
      code: 'github-refused',
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
