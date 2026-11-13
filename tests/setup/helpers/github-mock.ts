import { vi } from 'vitest'
import { buildArchive } from './skill-archives'
import type { ArchiveEntry } from './skill-archives'

export const GITHUB_SHA_ONE = '1'.repeat(40)
export const GITHUB_SHA_TWO = '2'.repeat(40)
export const GITHUB_SHA_THREE = '3'.repeat(40)

export interface GithubMock {
  fetch: ReturnType<typeof vi.fn>
  refs: Map<string, string>
  archives: Map<string, Uint8Array>
  compare: Map<string, string | number>
  defaultBranch: string
  repoStatus: number
  urls: () => string[]
}

export function githubRepoArchive(
  sha: string,
  entries: Record<string, ArchiveEntry>,
  repo = 'r',
): Uint8Array {
  return buildArchive(Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => {
      return [`${repo}-${sha}/${name}`, entry]
    }),
  ))
}

/**
 * A stand-in for the two GitHub hosts the skills import may call. Anything
 * else throws, so a test fails loudly if the code reaches for another URL.
 */
export function createGithubMock(owner = 'o', repo = 'r'): GithubMock {
  const refs = new Map<string, string>()
  const archives = new Map<string, Uint8Array>()
  const compare = new Map<string, string | number>()
  const state = {
    defaultBranch: 'main',
    repoStatus: 200,
  }
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input)

    if (url.startsWith(`${apiBase}/commits/`)) {
      const ref = url.slice(`${apiBase}/commits/`.length)
      const sha = refs.get(ref)

      return new Response(sha ?? '', { status: sha ? 200 : 422 })
    }

    if (url === apiBase) {
      return new Response(
        JSON.stringify({ default_branch: state.defaultBranch }),
        { status: state.repoStatus },
      )
    }

    if (url.startsWith(`${apiBase}/compare/`)) {
      const sha = url.split('...')[1]!.split('?')[0]!
      const result = compare.get(sha) ?? 404

      return typeof result === 'number'
        ? new Response('', { status: result })
        : new Response(JSON.stringify({ status: result }))
    }

    const archivePrefix = `https://codeload.github.com/${owner}/${repo}/zip/`

    if (url.startsWith(archivePrefix)) {
      const archive = archives.get(url.slice(archivePrefix.length))

      return archive
        ? new Response(archive as BodyInit)
        : new Response('', { status: 404 })
    }

    throw new Error(`Unexpected request: ${url}`)
  })

  return {
    fetch: fetchMock,
    refs,
    archives,
    compare,
    get defaultBranch() {
      return state.defaultBranch
    },
    set defaultBranch(value: string) {
      state.defaultBranch = value
    },
    get repoStatus() {
      return state.repoStatus
    },
    set repoStatus(value: number) {
      state.repoStatus = value
    },
    urls: () => {
      return fetchMock.mock.calls.map((call) => {
        return String(call[0])
      })
    },
  }
}
