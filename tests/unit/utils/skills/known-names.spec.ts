import { describe, expect, it } from 'vitest'
import {
  KNOWN_SKILL_NAMES,
  KNOWN_SKILL_OWNERS,
  findLookalikeName,
  getKnownSkillNames,
  isOfficialSkillsSource,
  measureEditDistance,
  splitGithubSource,
} from '#shared/utils/skills/known-names'
import { SKILL_TEMPLATE_IDS } from '#shared/utils/skills/templates'

describe('measureEditDistance', () => {
  it.each([
    ['pdf', 'pdf', 0],
    ['pdf', 'pdg', 1],
    ['pdf', 'pd', 1],
    ['pdf', 'pdff', 1],
    ['pdf', 'pfd', 1],
    ['docx', 'dcox', 1],
    ['skill-creator', 'skil-creater', 2],
    ['anthropic', 'anthropics', 1],
  ])('measures %s against %s as %i', (left, right, distance) => {
    expect(measureEditDistance(left, right, 3)).toBe(distance)
  })

  it('stops early when the length gap is past the limit', () => {
    expect(measureEditDistance('pdf', 'pdfxxxxx', 2)).toBe(3)
  })
})

describe('findLookalikeName', () => {
  it('flags a short name one edit away', () => {
    expect(findLookalikeName('pdg', ['pdf'])).toBe('pdf')
    expect(findLookalikeName('xlsxx', ['xlsx'])).toBe('xlsx')
  })

  it('does not flag a short name two edits away', () => {
    expect(findLookalikeName('pdfab', ['pdf'])).toBeNull()
    expect(findLookalikeName('pp', ['pdf'])).toBeNull()
  })

  it('flags a longer name up to two edits away', () => {
    expect(findLookalikeName('skill-creater', KNOWN_SKILL_NAMES))
      .toBe('skill-creator')
    expect(findLookalikeName('skil-creater', KNOWN_SKILL_NAMES))
      .toBe('skill-creator')
    expect(findLookalikeName('skil-createrx', KNOWN_SKILL_NAMES)).toBeNull()
  })

  it('gives nothing for an exact match, whatever the case', () => {
    expect(findLookalikeName('pdf', KNOWN_SKILL_NAMES)).toBeNull()
    expect(findLookalikeName('Claude-API', KNOWN_SKILL_NAMES)).toBeNull()
  })

  it('returns the closest of several known names', () => {
    expect(findLookalikeName('docs', ['docx', 'doc'])).toBe('docx')
  })

  it('does not flag an unrelated name', () => {
    expect(findLookalikeName('weekly-report-writer', KNOWN_SKILL_NAMES))
      .toBeNull()
  })

  it('flags a GitHub owner against the owner list the same way', () => {
    expect(findLookalikeName('anthropic', KNOWN_SKILL_OWNERS)).toBe('anthropics')
    expect(findLookalikeName('openal', KNOWN_SKILL_OWNERS)).toBe('openai')
    expect(findLookalikeName('anthropics', KNOWN_SKILL_OWNERS)).toBeNull()
    expect(findLookalikeName('some-person', KNOWN_SKILL_OWNERS)).toBeNull()
  })
})

describe('known name lists', () => {
  it('includes the template ids and the account other skills', () => {
    const names = getKnownSkillNames(['my-own-skill'])

    expect(names).toEqual(expect.arrayContaining([
      ...KNOWN_SKILL_NAMES,
      ...SKILL_TEMPLATE_IDS,
      'my-own-skill',
    ]))
  })

  it('knows the anthropics/skills source only in its exact form', () => {
    expect(isOfficialSkillsSource('anthropics/skills')).toBe(true)
    expect(isOfficialSkillsSource('Anthropics/Skills')).toBe(true)
    expect(isOfficialSkillsSource('anthropics/skills-fork')).toBe(false)
    expect(isOfficialSkillsSource('anthropic/skills')).toBe(false)
    expect(isOfficialSkillsSource(null)).toBe(false)
  })

  it('splits a GitHub source into owner and repository', () => {
    expect(splitGithubSource('a/b')).toEqual({ owner: 'a', repo: 'b' })
    expect(splitGithubSource('a')).toBeNull()
    expect(splitGithubSource(null)).toBeNull()
  })
})
