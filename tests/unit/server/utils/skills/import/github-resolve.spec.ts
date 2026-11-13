import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertCommitOnRepository,
  createGithubClient,
  downloadGithubArchive,
  githubFetch,
  resolveGithubRef,
  resolveGithubSource,
  resolveVerifiedGithubRef,
  withGithubArchiveSlot,
} from '~~/server/utils/skills/import/github'
import { parseGithubSkillUrl } from '#shared/utils/skills/github-url'
import { createGithubMock } from '../../../../../setup/helpers/github-mock'
import { createFakeSkillKv } from '../../../../../setup/helpers/skills-db'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const API = 'https://api.github.com/repos/o/r'
const OPTIONS = {
  purpose: 'skills-github' as const,
  accept: 'application/json',
  maxResponseBytes: 1024,
}
const REPOSITORY = { owner: 'o', repo: 'r' }

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

describe('resolveGithubRef', () => {
  it('confirms a branch first and takes its commit without a second call', async () => {
    const github = createGithubMock()

    github.setBranch('feature/x', SHA)

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch }),
      { ...REPOSITORY, ref: 'feature/x' },
    )).toEqual({ found: true, sha: SHA })
    expect(github.urls()).toEqual([`${API}/git/ref/heads/feature/x`])
  })

  it('falls back to a tag and peels an annotated one through the commit lookup', async () => {
    const github = createGithubMock()

    github.tags.set('v1', { sha: OTHER_SHA, type: 'tag' })
    github.refs.set('v1', SHA)

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch }),
      { ...REPOSITORY, ref: 'v1' },
    )).toEqual({ found: true, sha: SHA })
    expect(github.urls()).toEqual([
      `${API}/git/ref/heads/v1`,
      `${API}/git/ref/tags/v1`,
      `${API}/commits/v1`,
    ])
  })

  it('takes a lightweight tag as its commit', async () => {
    const github = createGithubMock()

    github.tags.set('v2', { sha: SHA, type: 'commit' })

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch }),
      { ...REPOSITORY, ref: 'v2' },
    )).toEqual({ found: true, sha: SHA })
  })

  it.each([
    'pull/1/head',
    'pull/1/merge',
    'refs/pull/1/head',
    'refs/heads/main',
    'keep-around/abc',
    '__gh__/x',
    'Pull/9/head',
  ])('refuses %s without calling GitHub', async (ref) => {
    const github = createGithubMock()

    github.refs.set(ref, SHA)

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch }),
      { ...REPOSITORY, ref },
    )).toEqual({ found: false, status: 422 })
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it('does not trust the commit lookup for a name that is no branch or tag', async () => {
    const github = createGithubMock()

    github.refs.set('hidden-fork-ref', SHA)

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch }),
      { ...REPOSITORY, ref: 'hidden-fork-ref' },
    )).toEqual({ found: false, status: 404 })
    expect(github.urls().some((url) => {
      return url.includes('/commits/')
    })).toBe(false)
  })

  it('refuses a ref answer that is not exactly the branch asked for', async () => {
    const fetchImpl = fetchOf((url) => {
      return url.includes('/git/ref/heads/')
        ? json({
          ref: 'refs/heads/main/extra',
          object: { sha: SHA, type: 'commit' },
        })
        : text('', 404)
    })

    expect(await resolveGithubRef(
      createGithubClient({ fetchImpl }),
      { ...REPOSITORY, ref: 'main' },
    )).toEqual({ found: false, status: 404 })
  })

  it('reads HEAD and a hex id through the commit lookup with the sha media type', async () => {
    const fetchImpl = fetchOf(() => text(`${SHA}\n`))
    const client = createGithubClient({ fetchImpl })

    expect(await resolveGithubRef(client, { ...REPOSITORY, ref: 'HEAD' }))
      .toEqual({ found: true, sha: SHA })
    expect(await resolveGithubRef(client, { ...REPOSITORY, ref: 'aaaaaaa' }))
      .toEqual({ found: true, sha: SHA })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${API}/commits/HEAD`)
    expect(new Headers(init.headers).get('accept'))
      .toBe('application/vnd.github.sha')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('answers a 404 or 422 from the commit lookup as a missing ref', async () => {
    for (const status of [404, 422]) {
      expect(await resolveGithubRef(
        createGithubClient({ fetchImpl: fetchOf(() => text('', status)) }),
        { ...REPOSITORY, ref: 'HEAD' },
      )).toEqual({ found: false, status })
    }
  })

  it('refuses a body that is not a commit SHA', async () => {
    const client = createGithubClient({
      fetchImpl: fetchOf(() => text('<html>')),
    })

    expect((await failureOf(resolveGithubRef(
      client,
      { ...REPOSITORY, ref: 'HEAD' },
    ))).code).toBe('github-unexpected-response')
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

  it('tries splits shortest first and stops at the first existing branch', async () => {
    const github = createGithubMock()

    github.setBranch('feature/x', SHA)

    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('github.com/o/r/tree/feature/x/skills/a'),
    )

    expect(source).toEqual({ sha: SHA, ref: 'feature/x', path: 'skills/a' })
    expect(github.urls()).toEqual([
      `${API}/git/ref/heads/feature`,
      `${API}/git/ref/tags/feature`,
      `${API}/git/ref/heads/feature/x`,
    ])
  })

  it('makes at most three ref candidates, then checks the repository once', async () => {
    const github = createGithubMock()
    const failure = await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('github.com/o/r/tree/a/b/c/d/e'),
    ))
    const refCalls = github.urls().filter((url) => {
      return url.includes('/git/ref/')
    })

    expect(refCalls).toHaveLength(6)
    expect(github.urls().at(-1)).toBe(API)
    expect(failure).toMatchObject({ code: 'github-ref-not-found', status: 404 })
  })

  it('reports a missing repository when the repository call is a 404', async () => {
    const github = createGithubMock()

    github.repoStatus = 404

    const failure = await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('github.com/o/r/tree/a/b/c'),
    ))

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

  it('does not run the compare check for a branch the repository has', async () => {
    const github = createGithubMock()

    github.setBranch('main', OTHER_SHA)

    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('github.com/o/r/tree/main/skills/a'),
    )

    expect(source.sha).toBe(OTHER_SHA)
    expect(github.urls()).toEqual([`${API}/git/ref/heads/main`])
  })

  it('lets a picked path replace the one in the link', async () => {
    const github = createGithubMock()

    github.setBranch('main', SHA)

    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('github.com/o/r/tree/main/skills'),
      { path: 'skills/a' },
    )

    expect(source.path).toBe('skills/a')
  })

  it('never reaches a pull request ref, whatever the link says', () => {
    const github = createGithubMock()

    github.refs.set('pull/1/head', SHA)

    expect(parseGithubSkillUrl('github.com/o/r/tree/pull/1/head/skills/a').ok)
      .toBe(false)
    expect(parseGithubSkillUrl('github.com/o/r/tree/pull/1/merge').ok)
      .toBe(false)
    expect(parseGithubSkillUrl('github.com/o/r/blob/pull/1/head/SKILL.md').ok)
      .toBe(false)
    expect(github.fetch).not.toHaveBeenCalled()
  })
})

describe('resolveVerifiedGithubRef and the shared GitHub quota', () => {
  it('caches a verified ref for a minute in KV', async () => {
    const github = createGithubMock()
    const kv = createFakeSkillKv()

    github.setBranch('main', SHA)

    const first = createGithubClient({ fetchImpl: github.fetch, kv })
    const second = createGithubClient({ fetchImpl: github.fetch, kv })

    await resolveVerifiedGithubRef(first, { ...REPOSITORY, ref: 'main' })
    github.fetch.mockClear()

    expect(await resolveVerifiedGithubRef(
      second,
      { ...REPOSITORY, ref: 'main' },
    )).toEqual({ found: true, sha: SHA })
    expect(github.fetch).not.toHaveBeenCalled()

    const cachePut = kv.put.mock.calls.find((call) => {
      return String(call[0]).includes(':ref:')
    })

    expect(cachePut![2]).toEqual({ expirationTtl: 60 })
  })

  it('does not cache a ref that was not found', async () => {
    const github = createGithubMock()
    const kv = createFakeSkillKv()
    const client = createGithubClient({ fetchImpl: github.fetch, kv })

    expect(await resolveVerifiedGithubRef(
      client,
      { ...REPOSITORY, ref: 'nope' },
    )).toMatchObject({ found: false })
    expect([...kv.values.keys()].some((key) => {
      return key.includes(':ref:')
    })).toBe(false)
  })

  it('caches the default branch for ten minutes', async () => {
    const github = createGithubMock()
    const kv = createFakeSkillKv()

    github.compare.set(SHA, 'identical')

    await assertCommitOnRepository(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      { ...REPOSITORY, sha: SHA },
    )
    github.fetch.mockClear()
    await assertCommitOnRepository(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      { ...REPOSITORY, sha: SHA },
    )

    expect(github.urls()).toEqual([`${API}/compare/main...${SHA}?per_page=1`])

    const branchPut = kv.put.mock.calls.find((call) => {
      return String(call[0]).includes(':branch:')
    })

    expect(branchPut![2]).toEqual({ expirationTtl: 600 })
  })

  it('spends one hourly budget of 50 API calls for the whole app, then fails closed', async () => {
    const github = createGithubMock()
    const kv = createFakeSkillKv()

    github.setBranch('main', SHA)

    for (let call = 0; call < 50; call++) {
      await resolveGithubRef(
        createGithubClient({ fetchImpl: github.fetch, kv }),
        { ...REPOSITORY, ref: 'main' },
      )
    }

    expect(github.fetch).toHaveBeenCalledTimes(50)

    const failure = await failureOf(resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      { ...REPOSITORY, ref: 'main' },
    ))

    expect(failure).toMatchObject({
      status: 429,
      message: 'GitHub rate limit reached',
    })
    expect(github.fetch).toHaveBeenCalledTimes(50)
  })

  it('does not count an archive download against the API budget', async () => {
    const kv = createFakeSkillKv()
    const fetchImpl = fetchOf(() => text('PK'))

    await downloadGithubArchive(
      createGithubClient({ fetchImpl, kv }),
      { ...REPOSITORY, sha: SHA },
    )

    expect(kv.put).not.toHaveBeenCalled()
  })

  it('fails closed when KV cannot be read or written', async () => {
    const kv = createFakeSkillKv()
    const github = createGithubMock()

    kv.get.mockRejectedValue(new Error('kv down'))
    github.setBranch('main', SHA)

    const failure = await failureOf(resolveGithubRef(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      { ...REPOSITORY, ref: 'main' },
    ))

    expect(failure.message).toBe('GitHub rate limit reached')
    expect(github.fetch).not.toHaveBeenCalled()
  })
})

describe('the request deadline', () => {
  it('refuses to start a call after the deadline without touching the network', async () => {
    const fetchImpl = fetchOf(() => text('x'))
    const client = createGithubClient({ fetchImpl, now: Date.now() - 61_000 })

    expect((await failureOf(resolveGithubRef(
      client,
      { ...REPOSITORY, ref: 'HEAD' },
    ))).code).toBe('github-timeout')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cuts a call short to the time that is left', async () => {
    vi.useFakeTimers()

    const fetchImpl = fetchOf((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    const client = createGithubClient({ fetchImpl, now: Date.now() - 55_000 })
    const pending = failureOf(resolveGithubRef(
      client,
      { ...REPOSITORY, ref: 'HEAD' },
    ))

    await vi.advanceTimersByTimeAsync(5_001)

    expect(await pending).toMatchObject({ code: 'github-timeout' })
  })
})

describe('the body buffer', () => {
  it('keeps every byte across a doubling buffer when there is no length header', async () => {
    const chunk = new Uint8Array(100 * 1024).fill(7)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk.map(() => 9))
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    const response = await githubFetch(
      `https://codeload.github.com/o/r/zip/${SHA}`,
      {
        ...OPTIONS,
        maxResponseBytes: 1024 * 1024,
        fetchImpl: fetchOf(() => new Response(stream)),
      },
    )

    expect(response.bytes.byteLength).toBe(200 * 1024 + 3)
    expect(response.bytes[0]).toBe(7)
    expect(response.bytes[100 * 1024]).toBe(9)
    expect(Array.from(response.bytes.slice(-3))).toEqual([1, 2, 3])
  })

  it('sizes the buffer from Content-Length when it is sent', async () => {
    const response = await githubFetch(
      `${API}/x`,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          return text('hello', 200, { 'content-length': '5' })
        }),
      },
    )

    expect(new TextDecoder().decode(response.bytes)).toBe('hello')
  })
})

describe('withGithubArchiveSlot', () => {
  it('runs one archive at a time and answers 503 to a second', async () => {
    let release: () => void = () => undefined
    const first = withGithubArchiveSlot(() => {
      return new Promise<string>((resolve) => {
        release = () => resolve('done')
      })
    })

    expect(await failureOf(withGithubArchiveSlot(async () => 'second')))
      .toMatchObject({
        status: 503,
        code: 'github-busy',
        message: 'Another GitHub import is running, try again in a moment',
      })

    release()

    expect(await first).toBe('done')
    expect(await withGithubArchiveSlot(async () => 'third')).toBe('third')
  })

  it('frees the slot when the task fails', async () => {
    await failureOf(withGithubArchiveSlot(async () => {
      throw new Error('boom')
    }))

    expect(await withGithubArchiveSlot(async () => 'ok')).toBe('ok')
  })
})
