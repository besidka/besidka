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

  it('refuses links that name no repository or an unknown kind', () => {
    expect(rejection('https://github.com/')).toContain('owner')
    expect(rejection('https://github.com/o')).toContain('owner')
    expect(rejection('https://github.com/o/r/issues/1')).toContain('Use a link')
    expect(rejection('https://github.com/o/r/tree')).toContain('not valid')
    expect(rejection('')).toContain('Paste')
    expect(rejection(`https://github.com/o/${'r'.repeat(700)}`))
      .toContain('Paste')
  })

  it('requires a blob link to end in SKILL.md', () => {
    expect(rejection('https://github.com/o/r/blob/main/README.md'))
      .toContain('SKILL.md')
    expect(rejection('https://github.com/o/r/blob/SKILL.md')).toContain('SKILL.md')
  })

  it('caps the length of the path', () => {
    const segments = Array.from({ length: 20 }, () => 'a').join('/')

    expect(rejection(`https://github.com/o/r/tree/main/${segments}`))
      .toContain('too long')
  })
})

describe('getGithubRefCandidates', () => {
  it('uses HEAD for a bare repository and the SHA for a commit link', () => {
    expect(getGithubRefCandidates(parse('github.com/o/r')))
      .toEqual([{ ref: 'HEAD', path: null }])
    expect(getGithubRefCandidates(parse(`github.com/o/r/commit/${SHA}`)))
      .toEqual([{ ref: SHA, path: null }])
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
