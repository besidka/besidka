import { describe, expect, it } from 'vitest'
import { JEV_SKILL_SELECTION } from '#shared/utils/jev-policy'
import {
  buildSkillQueryTerms,
  prefilterSkills,
  resolveSkillMinScore,
} from '~~/server/utils/skills/jev/prefilter'

const SKILLS = [
  {
    id: 'notes',
    name: 'meeting-notes',
    description: 'Turns a meeting transcript or rough notes into structured '
      + 'minutes with decisions, owners and action items.',
  },
  {
    id: 'commit',
    name: 'commit-message-writer',
    description: 'Writes Conventional Commits messages from a git diff.',
  },
  {
    id: 'sql',
    name: 'sql-review',
    description: 'Reviews SQL queries for correctness, indexes and '
      + 'dangerous statements before they run.',
  },
  {
    id: 'copyedit',
    name: 'ukrainian-copyedit',
    description: 'Проводить редагування українського тексту: орфографія, '
      + 'пунктуація, стиль і кальки з російської.',
  },
]

describe('buildSkillQueryTerms', () => {
  it('drops stop words, filler words and short tokens', () => {
    const terms = buildSkillQueryTerms('What is this? Help me with the SQL')

    expect(terms).toEqual(['sql'])
  })

  it('deduplicates terms and keeps at most maxQueryTerms of them', () => {
    const words = Array.from({ length: 60 }, (_value, index) => {
      return `term${index}`
    })

    expect(buildSkillQueryTerms('alpha alpha alpha')).toEqual(['alpha'])
    expect(buildSkillQueryTerms(words.join(' ')))
      .toHaveLength(JEV_SKILL_SELECTION.prefilter.maxQueryTerms)
  })
})

describe('prefilterSkills', () => {
  it('returns the matching skill with its score and matched terms', () => {
    const result = prefilterSkills(
      SKILLS,
      'Turn this meeting transcript into minutes with action items',
    )

    expect(result[0]!.skill.id).toBe('notes')
    expect(result[0]!.matchedTerms).toBeGreaterThanOrEqual(3)
    expect(result[0]!.score).toBeGreaterThan(
      JEV_SKILL_SELECTION.prefilter.minScore,
    )
  })

  it('returns nothing for a message that matches no skill', () => {
    expect(prefilterSkills(SKILLS, 'What is the capital of Australia?'))
      .toEqual([])
    expect(prefilterSkills(SKILLS, 'hello')).toEqual([])
  })

  it('returns nothing without skills or without usable terms', () => {
    expect(prefilterSkills([], 'review my SQL query')).toEqual([])
    expect(prefilterSkills(SKILLS, 'what is this the')).toEqual([])
  })

  it('keeps at most maxCandidates, best first', () => {
    const result = prefilterSkills(
      SKILLS,
      'review the sql, write commit messages and meeting notes',
      { maxCandidates: 2 },
    )

    expect(result).toHaveLength(2)
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score)
  })

  it('honors minMatchedTerms', () => {
    const message = 'review the sql'

    expect(prefilterSkills(SKILLS, message, { minMatchedTerms: 1 })
      .map(match => match.skill.id)).toContain('sql')
    expect(prefilterSkills(SKILLS, message, { minMatchedTerms: 3 }))
      .toEqual([])
  })

  it('stems Ukrainian words on both sides', () => {
    const result = prefilterSkills(
      SKILLS,
      'Відредагуй цей український текст, виправ пунктуацію та кальки',
    )

    expect(result[0]!.skill.id).toBe('copyedit')
  })

  it('matches the skill name as well as its description', () => {
    const result = prefilterSkills(
      [{ id: 'x', name: 'invoice-checker', description: 'Compares amounts.' }],
      'please check this invoice',
    )

    expect(result.map(match => match.skill.id)).toEqual(['x'])
  })
})

describe('resolveSkillMinScore', () => {
  it('keeps the floor with enough skills and lowers it for few', () => {
    expect(resolveSkillMinScore(1, 16)).toBe(1)
    expect(resolveSkillMinScore(1, 7)).toBe(1)
    expect(resolveSkillMinScore(1, 3)).toBeLessThan(1)
    expect(resolveSkillMinScore(1, 1)).toBeLessThan(
      resolveSkillMinScore(1, 3),
    )
    expect(resolveSkillMinScore(1, 1)).toBeGreaterThan(0)
  })
})
