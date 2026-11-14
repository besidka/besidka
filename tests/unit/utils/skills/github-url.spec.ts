import { describe, expect, it } from 'vitest'
import {
  getGithubRefCandidates,
  githubRepoUrl,
  githubTreeUrl,
  isGithubFullSha,
  isGithubShaLikeRef,
  parseGithubSkillUrl,
} from '#shared/utils/skills/github-url'

const SHA = 'a'.repeat(40)

function parse(input: string) {
  const result = parseGithubSkillUrl(input)

  if (!result.ok) {
    throw new Error(result.message)
  }

  return result.value
}

function rejection(input: string) {
  const result = parseGithubSkillUrl(input)

  if (result.ok) {
    throw new Error('Expected a rejection')
  }

  return result.message
}

describe('parseGithubSkillUrl', () => {
  it('reads a bare repository link, with or without a scheme', () => {
    expect(parse('https://github.com/owner/repo')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
      kind: 'repo',
    })
    expect(parse('github.com/owner/repo/')).toMatchObject({ kind: 'repo' })
    expect(parse('https://www.github.com/owner/repo.git')).toMatchObject({
      repo: 'repo',
    })
  })

  it('reads tree, blob and commit links', () => {
    expect(parse('https://github.com/o/r/tree/main/skills/a')).toMatchObject({
      kind: 'tree',
      refAndPath: ['main', 'skills', 'a'],
    })
    expect(parse('https://github.com/o/r/blob/main/skills/a/SKILL.md'))
      .toMatchObject({ kind: 'blob' })
    expect(parse(`https://github.com/o/r/commit/${SHA}`)).toMatchObject({
      kind: 'commit',
      commitSha: SHA,
    })
  })

  it('lowercases a commit SHA and refuses a short or extended one', () => {
    expect(parse(`https://github.com/o/r/commit/${'A'.repeat(40)}`))
      .toMatchObject({ commitSha: SHA })
    expect(rejection('https://github.com/o/r/commit/abc1234'))
      .toContain('40-character')
    expect(rejection(`https://github.com/o/r/commit/${SHA}/files`))
      .toContain('40-character')
  })

  it('ignores a query string and a fragment', () => {
    expect(parse('https://github.com/o/r/tree/main/a?tab=x#readme'))
      .toMatchObject({ refAndPath: ['main', 'a'] })
  })

  it('refuses every host but github.com', () => {
    expect(rejection('https://gitlab.com/o/r')).toContain('github.com')
    expect(rejection('https://github.com.evil.test/o/r')).toContain('github.com')
    expect(rejection('https://api.github.com/repos/o/r')).toContain('github.com')
    expect(rejection('https://raw.githubusercontent.com/o/r/main/a'))
      .toContain('github.com')
  })

  it('refuses plain http, credentials, ports and encoded characters', () => {
    expect(rejection('http://github.com/o/r')).toContain('https')
    expect(rejection('https://user:pw@github.com/o/r')).toContain('credentials')
    expect(rejection('https://github.com:8443/o/r')).toContain('port')
    expect(rejection('https://github.com/o/r/tree/main/a%2Fb'))
      .toContain('Encoded')
  })

  it('refuses segments outside the allowlist', () => {
    expect(rejection('https://github.com/o/r/tree/main/a b')).toBeTruthy()
    expect(rejection('https://github.com/o/r/tree/main/..')).toContain('not valid')
    expect(rejection('https://github.com/o_x/r')).toContain('owner')
    expect(rejection('https://github.com/o/r$')).toContain('repository name')
    expect(rejection('https://github.com/o/..')).toContain('owner')
  })

  it.each([
    'github.com/o/r/tree/pull/1/head',
    'github.com/o/r/tree/pull/1/merge/skills/a',
    'github.com/o/r/tree/refs/heads/main',
    'github.com/o/r/tree/refs/pull/1/head',
    'github.com/o/r/tree/keep-around/abc',
    'github.com/o/r/tree/__gh__/x',
    'github.com/o/r/blob/pull/1/head/SKILL.md',
    'github.com/o/r/tree/PULL/1/head',
  ])('refuses the pull request or internal ref in %s', (input) => {
    expect(rejection(input)).toContain('Pull request and internal refs')
  })

  it('refuses links that name no repository or an unknown kind', () => {
    expect(rejection('https://github.com/')).toContain('owner')
    expect(rejection('https://github.com/o')).toContain('owner')
    expect(rejection('https://github.com/o/r/issues/1'))
      .toContain('github.com/o/r/issues is a GitHub page')
    expect(rejection('https://github.com/o/r/tree')).toContain('not valid')
    expect(rejection('')).toContain('empty or longer')
    expect(rejection(`https://github.com/o/${'r'.repeat(700)}`))
      .toContain('empty or longer')
  })

  it('accepts a blob link to a folder or to a file other than SKILL.md', () => {
    expect(parse('https://github.com/o/r/blob/main/skills/a'))
      .toMatchObject({ kind: 'blob' })
    expect(parse('https://github.com/o/r/blob/main/README.md'))
      .toMatchObject({ kind: 'blob' })
    expect(parse('https://github.com/o/r/blob/main'))
      .toMatchObject({ kind: 'blob' })
  })

  it('refuses a SKILL.md with no branch, tag or commit before it', () => {
    expect(rejection('https://github.com/o/r/blob/SKILL.md')).toContain('SKILL.md')
    expect(rejection('https://github.com/o/r/tree/SKILL.md')).toContain('SKILL.md')
  })

  it('caps the length of the path', () => {
    const segments = Array.from({ length: 20 }, () => 'a').join('/')

    expect(rejection(`https://github.com/o/r/tree/main/${segments}`))
      .toContain('too long')
  })
})

describe('a link without tree or blob', () => {
  const ROUTES = [
    'issues',
    'pull',
    'pulls',
    'releases',
    'actions',
    'wiki',
    'tags',
    'branches',
    'commits',
    'compare',
    'discussions',
    'security',
    'pulse',
    'graphs',
    'settings',
    'projects',
    'packages',
    'deployments',
    'archive',
    'raw',
    'blame',
    'labels',
    'milestones',
    'network',
    'stargazers',
    'watchers',
    'forks',
  ]

  it('reads github.com/owner/repo/path as a folder of the default branch', () => {
    const value = parse(
      'https://github.com/AminBlg/SimpleEnglish/skills/simple-english',
    )

    expect(value).toMatchObject({
      owner: 'AminBlg',
      repo: 'SimpleEnglish',
      kind: 'path',
      refAndPath: ['skills', 'simple-english'],
    })
    expect(getGithubRefCandidates(value)).toEqual([
      { ref: 'HEAD', path: 'skills/simple-english' },
    ])
  })

  it.each([
    'github.com/o/r/skills/a',
    'www.github.com/o/r/skills/a',
    'https://www.github.com/o/r/skills/a/',
    'https://github.com/o/r/skills/a?tab=readme-ov-file',
    'https://github.com/o/r/skills/a#readme',
    'https://github.com/o/r/skills/a/?x=1#y',
    '  https://github.com/o/r/skills/a  ',
  ])('reads %s', (input) => {
    expect(getGithubRefCandidates(parse(input)))
      .toEqual([{ ref: 'HEAD', path: 'skills/a' }])
  })

  it('reads a trailing SKILL.md as its folder, and a bare one as the root', () => {
    expect(getGithubRefCandidates(parse('github.com/o/r/skills/a/SKILL.md')))
      .toEqual([{ ref: 'HEAD', path: 'skills/a' }])
    expect(getGithubRefCandidates(parse('github.com/o/r/SKILL.md')))
      .toEqual([{ ref: 'HEAD', path: null }])
  })

  it('still strips .git from the repository name', () => {
    expect(parse('https://github.com/o/r.git/skills/a')).toMatchObject({
      repo: 'r',
      kind: 'path',
    })
  })

  it.each(ROUTES)('refuses github.com/o/r/%s as a GitHub page', (route) => {
    expect(rejection(`https://github.com/o/r/${route}/anything`))
      .toBe(`github.com/o/r/${route} is a GitHub page, not a folder of the repository`)
  })

  it('refuses a path with a character GitHub paths do not use or one that is too long', () => {
    expect(rejection('https://github.com/o/r/skills/a b')).toContain('Encoded')
    expect(rejection('https://github.com/o/r/skills/a:b')).toContain('characters')
    expect(rejection(`https://github.com/o/r/${
      Array.from({ length: 12 }, () => 'a').join('/')
    }`)).toContain('too long')
  })

  it('never repeats the reason in the fix', () => {
    expect(rejection('https://github.com/o/r/issues/1')).not.toContain('Paste')
  })
})

describe('getGithubRefCandidates', () => {
  it('uses HEAD for a bare repository and the SHA for a commit link', () => {
    expect(getGithubRefCandidates(parse('github.com/o/r')))
      .toEqual([{ ref: 'HEAD', path: null }])
    expect(getGithubRefCandidates(parse(`github.com/o/r/commit/${SHA}`)))
      .toEqual([{ ref: SHA, path: null }])
  })

  it('never offers a reserved namespace as a candidate', () => {
    const value = parse('github.com/o/r/tree/main/pull/1/head')
    const candidates = getGithubRefCandidates(value)

    expect(candidates.map((candidate) => {
      return candidate.ref
    })).toEqual(['main', 'main/pull', 'main/pull/1'])
    expect(candidates.some((candidate) => {
      return candidate.ref.startsWith('pull')
    })).toBe(false)
  })

  it('lists up to three splits, shortest ref first', () => {
    expect(getGithubRefCandidates(
      parse('github.com/o/r/tree/feature/x/y/skills/a'),
    )).toEqual([
      { ref: 'feature', path: 'x/y/skills/a' },
      { ref: 'feature/x', path: 'y/skills/a' },
      { ref: 'feature/x/y', path: 'skills/a' },
    ])
  })

  it('gives a tree link to the repository root a null path', () => {
    expect(getGithubRefCandidates(parse('github.com/o/r/tree/main')))
      .toEqual([{ ref: 'main', path: null }])
  })

  it('reads the blob link of a skill folder like a tree link', () => {
    const url = 'https://github.com/AminBlg/SimpleEnglish/blob/main/skills/simple-english'

    expect(getGithubRefCandidates(parse(url))).toEqual([
      { ref: 'main', path: 'skills/simple-english' },
      { ref: 'main/skills', path: 'simple-english' },
      { ref: 'main/skills/simple-english', path: null },
    ])
    expect(getGithubRefCandidates(parse(
      url.replace('/blob/', '/tree/'),
    ))).toEqual(getGithubRefCandidates(parse(url)))
  })

  it('treats any non-SKILL.md blob path as a folder', () => {
    expect(getGithubRefCandidates(
      parse('github.com/o/r/blob/main/docs/README.md'),
    )[0]).toEqual({ ref: 'main', path: 'docs/README.md' })
    expect(getGithubRefCandidates(parse('github.com/o/r/blob/main')))
      .toEqual([{ ref: 'main', path: null }])
  })

  it('strips a trailing SKILL.md from a tree link too', () => {
    expect(getGithubRefCandidates(
      parse('github.com/o/r/tree/main/skills/a/SKILL.md'),
    )[0]).toEqual({ ref: 'main', path: 'skills/a' })
  })

  it('uses the parent folder of a blob link', () => {
    expect(getGithubRefCandidates(
      parse('github.com/o/r/blob/main/skills/a/SKILL.md'),
    )).toEqual([
      { ref: 'main', path: 'skills/a' },
      { ref: 'main/skills', path: 'a' },
      { ref: 'main/skills/a', path: null },
    ])
    expect(getGithubRefCandidates(parse('github.com/o/r/blob/main/SKILL.md')))
      .toEqual([{ ref: 'main', path: null }])
  })

  it('gives a SHA ref exactly one split', () => {
    expect(getGithubRefCandidates(
      parse(`github.com/o/r/tree/${SHA.toUpperCase()}/skills/a`),
    )).toEqual([{ ref: SHA, path: 'skills/a' }])
  })
})

describe('helpers', () => {
  it('recognises full and abbreviated SHAs', () => {
    expect(isGithubFullSha(SHA)).toBe(true)
    expect(isGithubFullSha('a'.repeat(39))).toBe(false)
    expect(isGithubShaLikeRef('abc1234')).toBe(true)
    expect(isGithubShaLikeRef('abc')).toBe(false)
    expect(isGithubShaLikeRef('main')).toBe(false)
  })

  it('builds canonical URLs', () => {
    expect(githubRepoUrl('o', 'r')).toBe('https://github.com/o/r')
    expect(githubTreeUrl({ owner: 'o', repo: 'r', ref: SHA, path: 'a/b' }))
      .toBe(`https://github.com/o/r/tree/${SHA}/a/b`)
    expect(githubTreeUrl({ owner: 'o', repo: 'r', ref: 'main', path: null }))
      .toBe('https://github.com/o/r/tree/main')
  })
})
