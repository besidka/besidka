import { vi } from 'vitest'
import { buildArchive } from './skill-archives'
import type { ArchiveEntry } from './skill-archives'

export const GITHUB_SHA_ONE = '1'.repeat(40)
export const GITHUB_SHA_TWO = '2'.repeat(40)
export const GITHUB_SHA_THREE = '3'.repeat(40)

export interface GithubTagFixture {
  sha: string
  peeled?: string
}

export interface GithubMock {
  fetch: ReturnType<typeof vi.fn>
  branches: Map<string, string>
  tags: Map<string, GithubTagFixture>
  setBranch: (name: string, sha: string) => void
  archives: Map<string, Uint8Array>
  raw: Map<string, string>
  defaultBranch: string
  repoStatus: number
  advertisement: () => Uint8Array
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

export function pktLine(text: string): string {
  return `${(text.length + 4).toString(16).padStart(4, '0')}${text}`
}

/**
 * A stand-in for the three GitHub hosts the skills import may call: the git
 * ref list on github.com, the archive on codeload.github.com and single files
 * on raw.githubusercontent.com. Anything else, `api.github.com` included,
 * throws, so a test fails loudly if the code reaches for another URL.
 */
export function createGithubMock(owner = 'o', repo = 'r'): GithubMock {
  const branches = new Map<string, string>()
  const tags = new Map<string, GithubTagFixture>()
  const archives = new Map<string, Uint8Array>()
  const raw = new Map<string, string>()
  const state = {
    defaultBranch: 'main',
    repoStatus: 200,
  }

  function advertisement(): Uint8Array {
    const headSha = branches.get(state.defaultBranch)
      ?? '0'.repeat(40)
    const lines = [
      pktLine('# service=git-upload-pack\n'),
      '0000',
      pktLine(`${headSha} HEAD\0multi_ack symref=HEAD:refs/heads/${
        state.defaultBranch
      } agent=git/github\n`),
      ...[...branches].map(([name, sha]) => {
        return pktLine(`${sha} refs/heads/${name}\n`)
      }),
      pktLine(`${'9'.repeat(40)} refs/pull/1/head\n`),
      ...[...tags].flatMap(([name, tag]) => {
        return [
          pktLine(`${tag.sha} refs/tags/${name}\n`),
          ...(tag.peeled
            ? [pktLine(`${tag.peeled} refs/tags/${name}^{}\n`)]
            : []),
        ]
      }),
      '0000',
    ]

    return new TextEncoder().encode(lines.join(''))
  }

  const refsUrl = `https://github.com/${owner}/${repo}.git/info/refs`
    + '?service=git-upload-pack'
  const archivePrefix = `https://codeload.github.com/${owner}/${repo}/zip/`
  const rawPrefix = `https://raw.githubusercontent.com/${owner}/${repo}/`
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input)

    if (url === refsUrl) {
      return state.repoStatus === 200
        ? new Response(advertisement() as BodyInit)
        : new Response('', { status: state.repoStatus })
    }

    if (url.startsWith(archivePrefix)) {
      const archive = archives.get(url.slice(archivePrefix.length))

      return archive
        ? new Response(archive as BodyInit)
        : new Response('', { status: 404 })
    }

    if (url.startsWith(rawPrefix)) {
      const text = raw.get(url.slice(rawPrefix.length))

      return text === undefined
        ? new Response('', { status: 404 })
        : new Response(text)
    }

    throw new Error(`Unexpected request: ${url}`)
  })

  return {
    fetch: fetchMock,
    branches,
    tags,
    setBranch: (name: string, sha: string) => {
      branches.set(name, sha)
    },
    archives,
    raw,
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
    advertisement,
    urls: () => {
      return fetchMock.mock.calls.map((call) => {
        return String(call[0])
      })
    },
  }
}
