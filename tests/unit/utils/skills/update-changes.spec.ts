import { describe, expect, it } from 'vitest'
import { diffSkillSettings } from '#shared/utils/skills/update-changes'
import { extractSkillHosts } from '#shared/utils/skills/url-hosts'

function skillMd(frontmatter: string): string {
  return `---\nname: review-pr\n${frontmatter}\n---\nBody\n`
}

describe('diffSkillSettings', () => {
  it('returns nothing when the settings read the same', () => {
    const text = skillMd('description: A\nallowed-tools: Read')

    expect(diffSkillSettings(text, text)).toEqual([])
  })

  it('reports a changed description and added allowed-tools', () => {
    expect(diffSkillSettings(
      skillMd('description: Old text'),
      skillMd('description: New text\nallowed-tools: Bash(*) Read'),
    )).toEqual([
      { key: 'allowed-tools', before: null, after: 'Bash(*) Read' },
      { key: 'description', before: 'Old text', after: 'New text' },
    ])
  })

  it('reports hooks that were added and removed', () => {
    const withHooks = skillMd(
      'description: A\nhooks:\n  PreToolUse:\n    - command: ./x.sh',
    )
    const without = skillMd('description: A')

    expect(diffSkillSettings(without, withHooks)).toEqual([{
      key: 'hooks',
      before: null,
      after: '{"PreToolUse":[{"command":"./x.sh"}]}',
    }])
    expect(diffSkillSettings(withHooks, without)[0]).toMatchObject({
      key: 'hooks',
      after: null,
    })
  })

  it('reads allowed-tools the same whether it is a list or a string', () => {
    expect(diffSkillSettings(
      skillMd('description: A\nallowed-tools: Read Grep'),
      skillMd('description: A\nallowed-tools:\n  - Read\n  - Grep'),
    )).toEqual([])
  })

  it('treats a missing SKILL.md on one side as unset settings', () => {
    expect(diffSkillSettings(undefined, skillMd('description: A')))
      .toEqual([{ key: 'description', before: null, after: 'A' }])
  })
})

describe('extractSkillHosts', () => {
  it('lists each lowercase host once', () => {
    expect(extractSkillHosts(
      'See https://Docs.Example/a and http://docs.example/b, plus (https://x.example:8080/y).',
    )).toEqual(['docs.example', 'x.example'])
  })

  it('skips text that is not a link', () => {
    expect(extractSkillHosts('Visit example dot com, or ftp://x.example'))
      .toEqual([])
  })

  it('finds a host in an image link', () => {
    expect(extractSkillHosts('![a](https://evil.example/p.png?q=1)'))
      .toEqual(['evil.example'])
  })
})
