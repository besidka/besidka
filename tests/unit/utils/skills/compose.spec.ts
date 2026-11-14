import { describe, expect, it } from 'vitest'
import {
  composeSkillMarkdown,
  formatSkillCatalogLine,
  splitSkillMarkdownParts,
} from '../../../../shared/utils/skills/compose'
import { parseSkillMarkdown } from '../../../../shared/utils/skills/frontmatter'

const SKILL_MD = [
  '---',
  'name: review-pr',
  'description: Review a pull request',
  'license: MIT',
  'metadata:',
  '  author: me',
  '---',
  '# Review',
  '',
  'Read the diff.',
  '',
].join('\n')

describe('splitSkillMarkdownParts', () => {
  it('splits the file into name, description, advanced YAML and body', () => {
    const parts = splitSkillMarkdownParts(SKILL_MD)

    expect(parts.mode).toBe('fields')
    expect(parts.name).toBe('review-pr')
    expect(parts.description).toBe('Review a pull request')
    expect(parts.advanced).toBe('license: MIT\nmetadata:\n  author: me')
    expect(parts.body).toBe('# Review\n\nRead the diff.\n')
  })

  it('gives an empty advanced box when there are no other keys', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\ndescription: b\n---\nBody',
    )

    expect(parts.advanced).toBe('')
  })

  it('keeps unknown keys in the advanced box', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\ndescription: b\nowner: team-x\n---\nBody',
    )

    expect(parts.advanced).toBe('owner: team-x')
  })

  it('reads a folded description as one string', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\ndescription: >-\n  one\n  two\n---\nBody',
    )

    expect(parts.description).toBe('one two')
  })

  it('falls back to one text part when there is no frontmatter', () => {
    const parts = splitSkillMarkdownParts('# Only a body\n')

    expect(parts.mode).toBe('text')
    expect(parts.body).toBe('# Only a body\n')
  })

  it('falls back to text when the frontmatter is not valid YAML', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\ndescription: [oops\n---\nBody',
    )

    expect(parts.mode).toBe('text')
    expect(parts.body).toContain('description: [oops')
  })

  it('falls back to text when a key is repeated', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\nname: b\ndescription: c\n---\nBody',
    )

    expect(parts.mode).toBe('text')
  })

  it('falls back to text when the description is not plain text', () => {
    const parts = splitSkillMarkdownParts(
      '---\nname: a\ndescription:\n  - one\n---\nBody',
    )

    expect(parts.mode).toBe('text')
  })

  it('normalises line endings and drops the byte order mark', () => {
    const parts = splitSkillMarkdownParts(
      '﻿---\r\nname: a\r\ndescription: b\r\n---\r\nBody\r\n',
    )

    expect(parts.mode).toBe('fields')
    expect(parts.body).toBe('Body\n')
  })
})

describe('composeSkillMarkdown', () => {
  it('writes the file back unchanged when nothing was edited', () => {
    const initial = splitSkillMarkdownParts(SKILL_MD)

    expect(composeSkillMarkdown(initial, initial)).toBe(SKILL_MD)
  })

  it('keeps the original frontmatter byte for byte when only the body changes', () => {
    const initial = splitSkillMarkdownParts(
      '---\nname: review-pr\ndescription:   spaced   out\n# a comment\nlicense: MIT\n---\nBody',
    )
    const edited = { ...initial, body: 'New body' }

    expect(composeSkillMarkdown(edited, initial)).toBe(
      '---\nname: review-pr\ndescription:   spaced   out\n# a comment\nlicense: MIT\n---\nNew body',
    )
  })

  it('rewrites the frontmatter when the name changes and keeps the rest', () => {
    const initial = splitSkillMarkdownParts(SKILL_MD)
    const composed = composeSkillMarkdown(
      { ...initial, name: 'review-code' },
      initial,
    )
    const parsed = parseSkillMarkdown(composed)

    expect(parsed.ok).toBe(true)

    if (parsed.ok) {
      expect(parsed.frontmatter.name).toBe('review-code')
      expect(parsed.frontmatter.description).toBe('Review a pull request')
      expect(parsed.frontmatter.license).toBe('MIT')
      expect(parsed.frontmatter.metadata).toEqual({ author: 'me' })
      expect(parsed.body).toBe(initial.body)
    }
  })

  it('quotes a description that YAML would misread', () => {
    const initial = splitSkillMarkdownParts(SKILL_MD)
    const description = 'Use when: the user says "review" # not a comment'
    const parsed = parseSkillMarkdown(composeSkillMarkdown(
      { ...initial, description },
      initial,
    ))

    expect(parsed.ok && parsed.frontmatter.description).toBe(description)
  })

  it('keeps a multi-line description as one value', () => {
    const initial = splitSkillMarkdownParts(SKILL_MD)
    const parsed = parseSkillMarkdown(composeSkillMarkdown(
      { ...initial, description: 'line one\nline two' },
      initial,
    ))

    expect(parsed.ok && parsed.frontmatter.description)
      .toBe('line one\nline two')
  })

  it('returns the whole text for a text part', () => {
    const initial = splitSkillMarkdownParts('# Only a body\n')

    expect(composeSkillMarkdown(
      { ...initial, body: '# Changed\n' },
      initial,
    )).toBe('# Changed\n')
  })

  it('reports a duplicated name when advanced YAML repeats it', () => {
    const initial = splitSkillMarkdownParts(SKILL_MD)
    const parsed = parseSkillMarkdown(composeSkillMarkdown(
      { ...initial, advanced: 'name: other' },
      initial,
    ))

    expect(parsed.ok).toBe(false)
  })
})

describe('formatSkillCatalogLine', () => {
  it('formats one catalog line', () => {
    expect(formatSkillCatalogLine('review-pr', 'Review a pull request'))
      .toBe('- review-pr: Review a pull request')
  })
})
