import { describe, expect, it } from 'vitest'
import {
  compareSemverTags,
  findReleaseTagForSha,
  formatGithubSourceVersion,
  isSemverTag,
  sortReleaseTagsDescending,
} from '#shared/utils/skills/release'

describe('isSemverTag', () => {
  it.each(['1.0.0', 'v2.1.2', '10.20.30'])('accepts %s', (tag) => {
    expect(isSemverTag(tag)).toBe(true)
  })

  it.each([
    '2.1',
    '2.1.2-rc.1',
    '2.1.2+build',
    'latest',
    'release-2.1.2',
    'V2.1.2',
    '1.2.3.4',
    '',
  ])('refuses %s', (tag) => {
    expect(isSemverTag(tag)).toBe(false)
  })
})

describe('sortReleaseTagsDescending', () => {
  it('orders numerically, not alphabetically, and drops non-releases', () => {
    const sorted = sortReleaseTagsDescending([
      ['2.9.0', 'a'],
      ['2.10.0', 'b'],
      ['2.10.0-rc.1', 'c'],
      ['v1.0.0', 'd'],
      ['nightly', 'e'],
      ['2.1.2', 'f'],
    ])

    expect(sorted.map((entry) => {
      return entry.tag
    })).toEqual(['2.10.0', '2.9.0', '2.1.2', 'v1.0.0'])
  })

  it('is stable for a v-prefixed and a plain tag of one version', () => {
    expect(compareSemverTags('v1.0.0', '1.0.0')).not.toBe(0)
    expect(compareSemverTags('1.0.0', '1.0.0')).toBe(0)
  })
})

describe('findReleaseTagForSha', () => {
  it('returns the highest release tag at a commit', () => {
    expect(findReleaseTagForSha([
      ['1.0.0', 'a'],
      ['1.0.1', 'a'],
      ['nightly', 'a'],
      ['2.0.0', 'b'],
    ], 'a')).toBe('1.0.1')
    expect(findReleaseTagForSha([['nightly', 'a']], 'a')).toBeNull()
  })
})

describe('formatGithubSourceVersion', () => {
  it('shows the tag for a tag ref and the short commit otherwise', () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12'

    expect(formatGithubSourceVersion({
      sourceRef: '2.1.2',
      sourceVersion: sha,
    })).toBe('2.1.2')
    expect(formatGithubSourceVersion({
      sourceRef: 'main',
      sourceVersion: sha,
    })).toBe('abcdef1')
    expect(formatGithubSourceVersion({
      sourceRef: null,
      sourceVersion: null,
    })).toBeNull()
  })
})
