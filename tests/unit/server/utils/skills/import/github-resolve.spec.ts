import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGithubClient,
  fetchGithubRefs,
  githubFetch,
  resolveGithubRef,
  resolveGithubSource,
  withGithubArchiveSlot,
} from '~~/server/utils/skills/import/github'
import { parseGithubSkillUrl } from '#shared/utils/skills/github-url'
import {
  GITHUB_SHA_ONE,
  GITHUB_SHA_THREE,
  GITHUB_SHA_TWO,
  createGithubMock,
} from '../../../../../setup/helpers/github-mock'
import { createFakeSkillKv } from '../../../../../setup/helpers/skills-db'

const SHA = 'a'.repeat(40)
const REFS = 'https://github.com/o/r.git/info/refs?service=git-upload-pack'
const ARCHIVE = `https://codeload.github.com/o/r/zip/${'a'.repeat(40)}`
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

function mockWithRefs() {
  const github = createGithubMock()

  github.setBranch('main', GITHUB_SHA_ONE)
  github.setBranch('feature/x', GITHUB_SHA_TWO)
  github.tags.set('v1', { sha: GITHUB_SHA_THREE, peeled: 'c'.repeat(40) })
  github.tags.set('v2', { sha: 'd'.repeat(40) })

  return github
}

function resolve(github: ReturnType<typeof mockWithRefs>, ref: string) {
  return resolveGithubRef(
    createGithubClient({ fetchImpl: github.fetch }),
    { ...REPOSITORY, ref },
  )
}

describe('resolveGithubRef', () => {
  it('takes a branch, with a slash in its name, from the ref list', async () => {
    const github = mockWithRefs()

    expect(await resolve(github, 'feature/x'))
      .toEqual({ found: true, sha: GITHUB_SHA_TWO })
    expect(github.urls()).toEqual([REFS])
  })

  it('takes the peeled commit of an annotated tag and a lightweight tag as it is', async () => {
    const github = mockWithRefs()

    expect(await resolve(github, 'v1'))
      .toEqual({ found: true, sha: 'c'.repeat(40) })
    expect(await resolve(github, 'v2'))
      .toEqual({ found: true, sha: 'd'.repeat(40) })
  })

  it('reads HEAD as the tip of the default branch', async () => {
    const github = mockWithRefs()

    github.defaultBranch = 'feature/x'

    expect(await resolve(github, 'HEAD'))
      .toEqual({ found: true, sha: GITHUB_SHA_TWO })
  })

  it('uses a full commit id as it is, in any case, without a request', async () => {
    const github = mockWithRefs()

    expect(await resolve(github, SHA.toUpperCase()))
      .toEqual({ found: true, sha: SHA })
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it('resolves a short commit id that starts exactly one branch or tag tip', async () => {
    const github = mockWithRefs()

    expect(await resolve(github, '2222222'))
      .toEqual({ found: true, sha: GITHUB_SHA_TWO })
    expect(await resolve(github, 'ccccccc'))
      .toEqual({ found: true, sha: 'c'.repeat(40) })
  })

  it('does not resolve a short commit id that starts no tip or more than one', async () => {
    const github = mockWithRefs()

    github.setBranch('other', `1${'9'.repeat(39)}`)

    expect(await resolve(github, '9999999')).toEqual({ found: false })
    expect(await resolve(github, '1')).toEqual({ found: false })
    expect(await resolve(github, 'deadbeef')).toEqual({ found: false })
  })

  it('prefers a branch over a tag of the same name', async () => {
    const github = mockWithRefs()

    github.tags.set('main', { sha: 'e'.repeat(40) })

    expect(await resolve(github, 'main'))
      .toEqual({ found: true, sha: GITHUB_SHA_ONE })
  })

  it('does not find a name that is neither a branch nor a tag', async () => {
    expect(await resolve(mockWithRefs(), 'nope')).toEqual({ found: false })
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
    const github = mockWithRefs()

    expect(await resolve(github, ref)).toEqual({ found: false })
    expect(github.fetch).not.toHaveBeenCalled()
  })
})

describe('fetchGithubRefs', () => {
  it.each([404, 401])('answers a missing or private repository on %i', async (status) => {
    const github = mockWithRefs()

    github.repoStatus = status

    expect(await failureOf(fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch }),
      REPOSITORY,
    ))).toMatchObject({ status: 404, code: 'github-not-found' })
  })

  it('maps a 5xx to github-unavailable', async () => {
    expect(await failureOf(fetchGithubRefs(
      createGithubClient({ fetchImpl: fetchOf(() => text('', 502)) }),
      REPOSITORY,
    ))).toMatchObject({ status: 502, code: 'github-unavailable' })
  })

  it('refuses an answer that is not a ref list', async () => {
    expect(await failureOf(fetchGithubRefs(
      createGithubClient({ fetchImpl: fetchOf(() => text('<html>')) }),
      REPOSITORY,
    ))).toMatchObject({ status: 502, code: 'github-unexpected-response' })
  })

  it('refuses a ref list over the cap with a way out', async () => {
    const failure = await failureOf(fetchGithubRefs(
      createGithubClient({
        fetchImpl: fetchOf(() => {
          return text('x', 200, { 'content-length': String(9 * 1024 * 1024) })
        }),
      }),
      REPOSITORY,
    ))

    expect(failure).toMatchObject({
      status: 413,
      code: 'github-refs-too-large',
    })
    expect(failure.fix).toContain('40-character commit id')
  })

  it('caches the parsed refs for a minute in KV and reuses them', async () => {
    const github = mockWithRefs()
    const kv = createFakeSkillKv()

    await fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      REPOSITORY,
    )

    const refsPut = kv.put.mock.calls.find((call) => {
      return String(call[0]).includes(':refs:')
    })

    expect(refsPut![2]).toEqual({ expirationTtl: 60 })

    const again = await fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      REPOSITORY,
    )

    expect(github.fetch).toHaveBeenCalledTimes(1)
    expect(again.branches.get('main')).toBe(GITHUB_SHA_ONE)
    expect(again.tags.get('v1')).toBe('c'.repeat(40))
    expect(again.head?.branch).toBe('main')
  })

  it('does not cache a repository that was not found', async () => {
    const github = mockWithRefs()
    const kv = createFakeSkillKv()

    github.repoStatus = 404

    await failureOf(fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      REPOSITORY,
    ))

    expect(kv.put).not.toHaveBeenCalled()
  })

  it('falls back to GitHub when KV fails or holds a broken value', async () => {
    const github = mockWithRefs()
    const kv = createFakeSkillKv()

    kv.get.mockRejectedValueOnce(new Error('kv down'))
    kv.put.mockRejectedValue(new Error('kv down'))

    expect((await fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch, kv }),
      REPOSITORY,
    )).branches.get('main')).toBe(GITHUB_SHA_ONE)

    const healthy = createFakeSkillKv()

    healthy.values.set('skills:github:refs:o/r', '{not json')

    expect((await fetchGithubRefs(
      createGithubClient({ fetchImpl: github.fetch, kv: healthy }),
      REPOSITORY,
    )).branches.get('main')).toBe(GITHUB_SHA_ONE)
  })
})

describe('resolveGithubSource', () => {
  it('resolves a bare repository through HEAD with one request', async () => {
    const github = mockWithRefs()
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('https://github.com/o/r'),
    )

    expect(source).toEqual({
      sha: GITHUB_SHA_ONE,
      ref: 'HEAD',
      path: null,
      warnings: [],
    })
    expect(github.urls()).toEqual([REFS])
  })

  it('tries splits shortest first and stops at the first existing branch', async () => {
    const github = mockWithRefs()
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('https://github.com/o/r/tree/feature/x/skills/a'),
    )

    expect(source).toMatchObject({
      sha: GITHUB_SHA_TWO,
      ref: 'feature/x',
      path: 'skills/a',
    })
    expect(github.fetch).toHaveBeenCalledTimes(1)
  })

  it('answers github-ref-not-found when no split exists, after one request', async () => {
    const github = mockWithRefs()
    const failure = await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('https://github.com/o/r/tree/a/b/c/d/skills'),
    ))

    expect(failure).toMatchObject({ status: 404, code: 'github-ref-not-found' })
    expect(failure.fix).toContain('branch, a tag or the full 40-character')
    expect(github.fetch).toHaveBeenCalledTimes(1)
  })

  it('answers github-not-found for a missing repository', async () => {
    const github = mockWithRefs()

    github.repoStatus = 404

    expect((await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('https://github.com/o/r/tree/main/skills/a'),
    ))).code).toBe('github-not-found')
  })

  it('answers a short commit id that starts no tip with the ref message', async () => {
    const github = mockWithRefs()

    expect((await failureOf(resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed('https://github.com/o/r/tree/1234567/skills/a'),
    ))).code).toBe('github-ref-not-found')
  })

  it('takes a full commit id from the link as it is, with no warning for a branch tip', async () => {
    const github = mockWithRefs()
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed(`https://github.com/o/r/commit/${GITHUB_SHA_ONE}`),
      { path: 'skills/a' },
    )

    expect(source).toMatchObject({
      sha: GITHUB_SHA_ONE,
      ref: GITHUB_SHA_ONE,
      path: 'skills/a',
      warnings: [],
    })
  })

  it('warns that a commit which is no branch or tag tip cannot be confirmed', async () => {
    const github = mockWithRefs()
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: github.fetch }),
      parsed(`https://github.com/o/r/commit/${'f'.repeat(40)}`),
      { path: 'skills/a' },
    )

    expect(source.sha).toBe('f'.repeat(40))
    expect(source.warnings.join(' ')).toContain('cannot confirm that commit')
  })

  it('still imports a full commit id with the same warning when the ref list is unreadable', async () => {
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: fetchOf(() => text('', 503)) }),
      parsed(`https://github.com/o/r/commit/${SHA}`),
      { path: null },
    )

    expect(source.sha).toBe(SHA)
    expect(source.warnings).toHaveLength(1)
  })

  it('lets a picked path replace the one in the link', async () => {
    const source = await resolveGithubSource(
      createGithubClient({ fetchImpl: mockWithRefs().fetch }),
      parsed('https://github.com/o/r'),
      { path: 'skills/picked' },
    )

    expect(source.path).toBe('skills/picked')
  })

  it('never reaches a pull request ref, whatever the link says', () => {
    for (const url of [
      'https://github.com/o/r/tree/pull/1/head/skills',
      'https://github.com/o/r/blob/refs/pull/1/head/SKILL.md',
    ]) {
      expect(parseGithubSkillUrl(url).ok).toBe(false)
    }
  })

  it('never sends a request to api.github.com', async () => {
    const github = mockWithRefs()
    const client = createGithubClient({ fetchImpl: github.fetch })

    await resolveGithubSource(client, parsed('https://github.com/o/r'))
    await resolveGithubSource(
      client,
      parsed('https://github.com/o/r/tree/feature/x/skills'),
    )
    await resolveGithubSource(
      client,
      parsed(`https://github.com/o/r/commit/${'f'.repeat(40)}`),
      { path: null },
    )

    expect(github.urls().every((url) => {
      return !url.includes('api.github.com')
    })).toBe(true)
  })
})

describe('the request deadline', () => {
  it('refuses to start a call after the deadline without touching the network', async () => {
    const fetchImpl = fetchOf(() => text('x'))
    const client = createGithubClient({ fetchImpl, now: Date.now() - 61_000 })

    expect((await failureOf(resolveGithubRef(
      client,
      { ...REPOSITORY, ref: 'HEAD' },
    ))).code).toBe('github-unavailable')
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

    expect(await pending).toMatchObject({ code: 'github-unavailable' })
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

  it('ignores a Content-Length that counts the compressed body', async () => {
    const response = await githubFetch(
      ARCHIVE,
      {
        ...OPTIONS,
        fetchImpl: fetchOf(() => {
          return text('x'.repeat(500), 200, {
            'content-length': '120',
            'content-encoding': 'gzip',
          })
        }),
      },
    )

    expect(response.bytes.byteLength).toBe(500)
  })

  it('sizes the buffer from Content-Length when it is sent', async () => {
    const response = await githubFetch(
      ARCHIVE,
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
