import { describe, expect, it } from 'vitest'
import {
  parseSkillMarkdown,
  renameSkillMarkdown,
} from '#shared/utils/skills/frontmatter'

function markdown(frontmatter: string, body = 'Body text\n'): string {
  return `---\n${frontmatter}\n---\n${body}`
}

function parseOk(text: string) {
  const result = parseSkillMarkdown(text)

  if (!result.ok) {
    throw new Error(`Expected ok, got ${result.code}`)
  }

  return result
}

describe('parseSkillMarkdown', () => {
  it('parses the required fields and the body', () => {
    const result = parseOk(markdown(
      'name: review-pr\ndescription: Review a pull request',
      '# Title\n',
    ))

    expect(result.frontmatter.name).toBe('review-pr')
    expect(result.frontmatter.description).toBe('Review a pull request')
    expect(result.body).toBe('# Title\n')
    expect(result.warnings).toEqual([])
  })

  it('accepts CRLF text and a BOM', () => {
    const result = parseOk(
      '\uFEFF---\r\nname: a\r\ndescription: b\r\n---\r\nBody',
    )

    expect(result.frontmatter.name).toBe('a')
  })

  it.each([
    ['Bad_Name', 'name-invalid'],
    ['-lead', 'name-invalid'],
    ['trail-', 'name-invalid'],
    ['double--hyphen', 'name-invalid'],
    ['UPPER', 'name-invalid'],
    ['a'.repeat(65), 'name-invalid'],
  ])('rejects the name %s', (name, code) => {
    const result = parseSkillMarkdown(
      markdown(`name: ${name}\ndescription: ok`),
    )

    expect(result).toMatchObject({ ok: false, code })
  })

  it('rejects a missing name or description', () => {
    expect(parseSkillMarkdown(markdown('description: ok'))).toMatchObject({
      ok: false,
      code: 'name-missing',
    })
    expect(parseSkillMarkdown(markdown('name: a'))).toMatchObject({
      ok: false,
      code: 'description-missing',
    })
    expect(
      parseSkillMarkdown(markdown('name: a\ndescription: "   "')),
    ).toMatchObject({ ok: false, code: 'description-missing' })
  })

  it('cuts a long description with a warning', () => {
    const result = parseOk(markdown(
      `name: a\ndescription: ${'x'.repeat(2000)}`,
    ))

    expect(result.frontmatter.description).toHaveLength(1024)
    expect(result.warnings).toContain('"description" was cut to 1024 characters')
  })

  it('cuts compatibility to 500 characters', () => {
    const result = parseOk(markdown(
      `name: a\ndescription: b\ncompatibility: ${'c'.repeat(600)}`,
    ))

    expect(result.frontmatter.compatibility).toHaveLength(500)
  })

  it('stringifies non-string metadata values with a warning', () => {
    const result = parseOk(markdown(
      'name: a\ndescription: b\nmetadata:\n  version: 2\n  tags: [x, y]\n  owner: me',
    ))

    expect(result.frontmatter.metadata).toEqual({
      version: '2',
      tags: '["x","y"]',
      owner: 'me',
    })
    expect(result.warnings).toContain(
      'Non-text "metadata" values were converted to text',
    )
  })

  it('reads allowed-tools as text or a list and keeps unknown keys as warnings', () => {
    const text = parseOk(markdown(
      'name: a\ndescription: b\nallowed-tools: Bash(git:*) Read\nweird: 1',
    ))
    const list = parseOk(markdown(
      'name: a\ndescription: b\nallowed-tools:\n  - Read\n  - Write',
    ))

    expect(text.frontmatter.allowedTools).toEqual(['Bash(git:*)', 'Read'])
    expect(text.warnings).toContain('Unknown frontmatter key "weird" is kept')
    expect(list.frontmatter.allowedTools).toEqual(['Read', 'Write'])
  })

  it('keeps the license field as plain text', () => {
    const result = parseOk(markdown(
      'name: a\ndescription: b\nlicense: Apache-2.0',
    ))

    expect(result.frontmatter.license).toBe('Apache-2.0')
  })

  it('recovers an unquoted value that contains a colon', () => {
    const result = parseOk(markdown(
      'name: a\ndescription: Use when: the user asks for a review',
    ))

    expect(result.frontmatter.description).toBe(
      'Use when: the user asks for a review',
    )
  })

  it('rejects billion-laughs alias expansion', () => {
    const laughs = [
      'name: a',
      'description: b',
      'x: &a [lol, lol, lol, lol]',
      'y: &b [*a, *a, *a, *a]',
      'z: &c [*b, *b, *b, *b]',
      'w: [*c, *c, *c, *c]',
    ].join('\n')

    expect(parseSkillMarkdown(markdown(laughs))).toMatchObject({
      ok: false,
      code: 'frontmatter-invalid',
    })
  })

  it.each([
    'name: a\nname: b\ndescription: d',
    'name: a\ndescription: d\nname: b',
    'name: a\n"name": b\ndescription: d',
    'name: a\n\'name\' : b\ndescription: d',
  ])('rejects duplicate name keys (%#)', (block) => {
    expect(parseSkillMarkdown(markdown(block))).toMatchObject({
      ok: false,
      code: 'frontmatter-invalid',
    })
  })

  it('does not mistake a nested or longer key for a second name', () => {
    const result = parseOk(markdown(
      'name: a\ndescription: d\nmetadata:\n  name: inner\nnickname: x',
    ))

    expect(result.frontmatter.name).toBe('a')
  })

  it('rejects a missing, unterminated, oversized or non-map block', () => {
    expect(parseSkillMarkdown('no frontmatter')).toMatchObject({
      ok: false,
      code: 'frontmatter-missing',
    })
    expect(parseSkillMarkdown('---\nname: a\n')).toMatchObject({
      ok: false,
      code: 'frontmatter-unterminated',
    })
    expect(
      parseSkillMarkdown(markdown(`name: a\ndescription: b\nnote: ${'x'.repeat(20000)}`)),
    ).toMatchObject({ ok: false, code: 'frontmatter-too-large' })
    expect(parseSkillMarkdown(markdown('- a\n- b'))).toMatchObject({
      ok: false,
      code: 'frontmatter-invalid',
    })
  })
})

describe('Claude Code keys as defaults for the user-set columns', () => {
  it('defaults to an Auto skill that is also a /name command', () => {
    const { defaults } = parseOk(markdown('name: a\ndescription: b')).frontmatter

    expect(defaults).toEqual({
      modelInvocable: true,
      slashCommand: true,
      argumentHint: null,
    })
  })

  it('turns disable-model-invocation into Only when I ask', () => {
    const { defaults } = parseOk(markdown(
      'name: a\ndescription: b\ndisable-model-invocation: true\nargument-hint: "[issue]"',
    )).frontmatter

    expect(defaults).toEqual({
      modelInvocable: false,
      slashCommand: true,
      argumentHint: '[issue]',
    })
  })

  it('ignores user-invocable: every skill is a /name command', () => {
    expect(parseOk(markdown(
      'name: a\ndescription: b\nuser-invocable: false',
    )).frontmatter.defaults.slashCommand).toBe(true)
    expect(parseOk(markdown(
      'name: a\ndescription: b\ndisable-model-invocation: true\nuser-invocable: false',
    )).frontmatter.defaults).toMatchObject({
      modelInvocable: false,
      slashCommand: true,
    })
  })

  it('refuses the slash default for a reserved name', () => {
    const result = parseOk(markdown(
      'name: search\ndescription: b',
    ))

    expect(result.frontmatter.defaults.slashCommand).toBe(false)
    expect(result.warnings.join(' ')).toContain('/search is reserved')
  })

  it('cuts the argument hint to 100 characters', () => {
    const { defaults } = parseOk(markdown(
      `name: a\ndescription: b\nargument-hint: ${'h'.repeat(150)}`,
    )).frontmatter

    expect(defaults.argumentHint).toHaveLength(100)
  })

  it('never lets a frontmatter key set enabled or scripts', () => {
    const result = parseOk(markdown(
      'name: a\ndescription: b\nenabled: true\nallow-scripts: true',
    ))

    expect(Object.keys(result.frontmatter)).not.toContain('enabled')
    expect(result.warnings).toContain('Unknown frontmatter key "enabled" is kept')
  })
})

describe('renameSkillMarkdown', () => {
  it('rewrites only the name line', () => {
    const source = '---\nname: old-name\ndescription: Keep: me\n---\nBody name: x\n'

    expect(renameSkillMarkdown(source, 'new-name')).toBe(
      '---\nname: new-name\ndescription: Keep: me\n---\nBody name: x\n',
    )
  })

  it('keeps CRLF line endings and a byte order mark', () => {
    const source = '\uFEFF---\r\nname: old\r\ndescription: d\r\n---\r\nBody'

    expect(renameSkillMarkdown(source, 'new')).toBe(
      '\uFEFF---\r\nname: new\r\ndescription: d\r\n---\r\nBody',
    )
  })

  it('handles a quoted name and the result still parses to the new name', () => {
    const renamed = renameSkillMarkdown(
      '---\nname: "old"\ndescription: d\n---\n',
      'fresh',
    )

    expect(renamed).not.toBeNull()
    expect(parseOk(renamed!).frontmatter.name).toBe('fresh')
  })

  it('does not touch an indented name key or a missing block', () => {
    expect(renameSkillMarkdown(
      '---\ndescription: d\nmetadata:\n  name: inner\n---\n',
      'x',
    )).toBeNull()
    expect(renameSkillMarkdown('no frontmatter\nname: a', 'x')).toBeNull()
  })
})

describe('renameSkillMarkdown line endings and quoted keys', () => {
  it('rewrites a CRLF name line without touching the carriage return', () => {
    const source = '---\r\nname: old\r\ndescription: d\r\n---\r\nBody\r\n'

    expect(renameSkillMarkdown(source, 'fresh')).toBe(
      '---\r\nname: fresh\r\ndescription: d\r\n---\r\nBody\r\n',
    )
  })

  it('rewrites a quoted name key', () => {
    expect(renameSkillMarkdown(
      '---\n"name": old\ndescription: d\n---\n',
      'fresh',
    )).toBe('---\nname: fresh\ndescription: d\n---\n')
  })

  it('keeps a stray carriage return after the value out of the new name', () => {
    const renamed = renameSkillMarkdown(
      '---\nname: old\r\ndescription: d\n---\n',
      'fresh',
    )

    expect(renamed).toBe('---\nname: fresh\r\ndescription: d\n---\n')
  })
})
