import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertAllowedGithubUrl,
  createGithubClient,
  downloadGithubArchive,
  fetchGithubSkillMarkdown,
  githubFetch,
} from '~~/server/utils/skills/import/github'

const SHA = 'a'.repeat(40)
const RAW = 'https://raw.githubusercontent.com/o/r'
const REFS = 'https://github.com/o/r.git/info/refs?service=git-upload-pack'
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
  it('accepts the ref list, the archive and a raw file, nothing else', () => {
    expect(assertAllowedGithubUrl(REFS).hostname).toBe('github.com')
    expect(assertAllowedGithubUrl(`https://codeload.github.com/o/r/zip/${SHA}`)
      .hostname).toBe('codeload.github.com')
    expect(assertAllowedGithubUrl(`${RAW}/${SHA}/SKILL.md`).hostname)
      .toBe('raw.githubusercontent.com')
  })

  it.each([
    ['api.github.com', 'https://api.github.com/repos/o/r/commits/main'],
    ['a host outside the allowlist', 'https://evil.example.com/o/r'],
    ['github.com archive downloads', `https://github.com/o/r/archive/${SHA}.zip`],
    ['github.com pages other than the ref list', 'https://github.com/o/r'],
    ['the ref list without the service query', 'https://github.com/o/r.git/info/refs'],
    ['the ref list for another service', 'https://github.com/o/r.git/info/refs?service=git-receive-pack'],
    ['an extra query on the ref list', `${REFS}&x=1`],
    ['a lookalike host', 'https://raw.githubusercontent.com.evil.test/o/r/a'],
    ['plain http', 'http://raw.githubusercontent.com/o/r/a'],
    ['credentials', 'https://user:pw@raw.githubusercontent.com/o/r/a'],
    ['a port', 'https://raw.githubusercontent.com:8443/o/r/a'],
    ['an IP literal', 'https://140.82.112.5/o/r'],
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
      'http://raw.githubusercontent.com/o/r/x',
      { ...OPTIONS, fetchImpl },
    ))

    expect(failure.code).toBe('github-host-not-allowed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends a User-Agent, manual redirects and no credential', async () => {
    const fetchImpl = fetchOf(() => text('ok'))

    await githubFetch(`${RAW}/x`, { ...OPTIONS, fetchImpl })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)

    expect(init.redirect).toBe('manual')
    expect(init.method).toBe('GET')
    expect(headers.get('user-agent')).toMatch(/^Besidka-Skills\//)
    expect(headers.get('accept')).toBe('application/json')
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
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl },
    ))).code).toBe('github-redirect')
  })

  it('maps 429 to the rate limit message', async () => {
    const failure = await failureOf(githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 429)) },
    ))

    expect(failure).toMatchObject({
      status: 429,
      code: 'github-rate-limited',
      message: 'GitHub rate limit reached',
      fix: 'Try again in a few minutes or upload a zip',
    })
  })

  it('calls a 403 a refusal', async () => {
    const failure = await failureOf(githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 403)) },
    ))

    expect(failure).toMatchObject({
      status: 502,
      message: 'GitHub refused the request',
      code: 'github-refused',
    })
  })

  it('returns 404 and 401 to the caller and errors on 5xx and others', async () => {
    expect(await githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 404)) },
    )).toMatchObject({ status: 404 })
    expect(await githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 401)) },
    )).toMatchObject({ status: 401 })
    expect(await failureOf(githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 503)) },
    ))).toMatchObject({ status: 502, code: 'github-unavailable' })
    expect((await failureOf(githubFetch(
      `${RAW}/x`,
      { ...OPTIONS, fetchImpl: fetchOf(() => text('', 400)) },
    ))).code).toBe('github-unexpected-response')
  })

  it('refuses a declared Content-Length over the cap before reading', async () => {
    const failure = await failureOf(githubFetch(
      `${RAW}/x`,
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
      `${RAW}/x`,
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
      `${RAW}/x`,
      { ...OPTIONS, timeoutMs: 1000, fetchImpl },
    ))

    await vi.advanceTimersByTimeAsync(1001)

    expect(await pending).toMatchObject({ status: 502, code: 'github-unavailable' })
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
      `${RAW}/x`,
      {
        ...OPTIONS,
        timeoutMs: 1000,
        fetchImpl: fetchOf(() => new Response(stream)),
      },
    ))

    await vi.advanceTimersByTimeAsync(1001)

    expect(await pending).toMatchObject({ code: 'github-unavailable' })
  })

  it('reports a network failure as unavailable', async () => {
    const failure = await failureOf(githubFetch(
      `${RAW}/x`,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          throw new TypeError('network down')
        }),
      },
    ))

    expect(failure).toMatchObject({ status: 502, code: 'github-unavailable' })
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

describe('fetchGithubSkillMarkdown', () => {
  it('reads SKILL.md from raw by commit, at the root or in a folder', async () => {
    const fetchImpl = fetchOf(() => text('# Skill'))
    const client = createGithubClient({ fetchImpl })

    await fetchGithubSkillMarkdown(client, {
      owner: 'o',
      repo: 'r',
      sha: SHA,
      folder: null,
    })
    await fetchGithubSkillMarkdown(client, {
      owner: 'o',
      repo: 'r',
      sha: SHA,
      folder: 'skills/review-pr',
    })

    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      `${RAW}/${SHA}/SKILL.md`,
      `${RAW}/${SHA}/skills/review-pr/SKILL.md`,
    ])
  })

  it('answers null for a missing file and refuses a branch name or a bad folder', async () => {
    const fetchImpl = fetchOf(() => text('', 404))
    const client = createGithubClient({ fetchImpl })

    expect(await fetchGithubSkillMarkdown(client, {
      owner: 'o',
      repo: 'r',
      sha: SHA,
      folder: null,
    })).toBeNull()

    for (const input of [
      { sha: 'main', folder: null },
      { sha: SHA, folder: '../etc' },
    ]) {
      await failureOf(fetchGithubSkillMarkdown(client, {
        owner: 'o',
        repo: 'r',
        ...input,
      }))
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
