import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import { skillMarkdown } from '../../../setup/helpers/skill-archives'

const encoder = new TextEncoder()

function file(path: string, text: string) {
  return { path, bytes: encoder.encode(text), text }
}

function licence(name: string): string {
  return readFileSync(
    join(process.cwd(), 'tests/fixtures/skills/licences', name),
    'utf8',
  )
}

describe('analyseSkillFiles', () => {
  it('keeps a pasted SKILL.md at class none and returns the frontmatter', async () => {
    const result = await analyseSkillFiles({
      files: [file('SKILL.md', skillMarkdown())],
      folderName: null,
    })

    expect(result).toMatchObject({
      ok: true,
      skill: { name: 'review-pr' },
      licence: { class: 'none' },
      files: [{ path: 'SKILL.md', kind: 'skill-md' }],
    })
  })

  it('blocks a restricted licence on every source', async () => {
    const result = await analyseSkillFiles({
      files: [
        file('SKILL.md', skillMarkdown({ extra: 'license: Proprietary' })),
        file('LICENSE.txt', licence('anthropic-proprietary.txt')),
      ],
      folderName: 'review-pr',
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'licence-restricted',
      licence: { class: 'restricted' },
    })
  })

  it('never assigns authored', async () => {
    const result = await analyseSkillFiles({
      files: [
        file('SKILL.md', skillMarkdown()),
        file('LICENSE', licence('mit.txt')),
      ],
      folderName: null,
    })

    expect(result.ok && result.licence.class).toBe('open')
  })

  it('warns when the folder name differs from the skill name', async () => {
    const result = await analyseSkillFiles({
      files: [file('SKILL.md', skillMarkdown({ name: 'review-pr' }))],
      folderName: 'other-folder',
    })

    expect(result.ok && result.warnings.join(' ')).toContain(
      'The folder name "other-folder" differs',
    )
  })

  it('collects findings and counts across files', async () => {
    const result = await analyseSkillFiles({
      files: [
        file('SKILL.md', skillMarkdown({ body: 'Run curl https://x.example' })),
        file('scripts/run.sh', 'sudo rm -rf /tmp/x\n'),
      ],
      folderName: null,
    })

    expect(result.ok && result.findingCounts).toEqual({ url: 1, shell: 3 })
  })

  it('gives the same content hash whatever the file order', async () => {
    const files = [
      file('SKILL.md', skillMarkdown()),
      file('references/a.md', 'a'),
      file('references/b.md', 'b'),
    ]
    const forward = await analyseSkillFiles({ files, folderName: null })
    const reversed = await analyseSkillFiles({
      files: [...files].reverse(),
      folderName: null,
    })

    expect(forward.ok && reversed.ok && forward.contentSha256)
      .toBe(reversed.ok && reversed.contentSha256)
  })

  it.each([
    [file('SKILL.md', 'no frontmatter'), 'frontmatter-missing'],
    [file('SKILL.md', skillMarkdown({ name: 'Bad_Name' })), 'name-invalid'],
  ])('reports a frontmatter error as %#', async (skillMd, code) => {
    const result = await analyseSkillFiles({
      files: [skillMd],
      folderName: null,
    })

    expect(result).toMatchObject({ ok: false, code })
  })

  it('reports a missing SKILL.md', async () => {
    const result = await analyseSkillFiles({
      files: [file('notes.md', 'x')],
      folderName: null,
    })

    expect(result).toMatchObject({ ok: false, code: 'skill-md-missing' })
  })
})
