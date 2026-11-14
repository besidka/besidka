import { describe, expect, it } from 'vitest'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import {
  BLANK_SKILL_DESCRIPTION,
  buildBlankSkillFiles,
} from '#shared/utils/skills/blank'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import {
  SKILL_TEMPLATES,
  SKILL_TEMPLATE_IDS,
  getSkillTemplate,
} from '#shared/utils/skills/templates'
import {
  isReservedSkillSlashName,
  validateSkillSlashName,
} from '#shared/utils/skills-policy'
import { validateSkillEditPath } from '#shared/utils/skills/edit'

const encoder = new TextEncoder()

function toAnalysisFiles(files: Array<{ path: string, content: string }>) {
  return files.map((file) => {
    return {
      path: file.path,
      bytes: encoder.encode(file.content),
      text: file.content,
    }
  })
}

describe('skill templates', () => {
  it('ships three to four templates with distinct ids and names', () => {
    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    expect(SKILL_TEMPLATES.length).toBeLessThanOrEqual(4)
    expect(new Set(SKILL_TEMPLATE_IDS).size).toBe(SKILL_TEMPLATES.length)
    expect(new Set(SKILL_TEMPLATES.map((template) => {
      return template.name
    })).size).toBe(SKILL_TEMPLATES.length)
  })

  it('offers both a skill and a command', () => {
    expect(SKILL_TEMPLATES.some((template) => {
      return template.slashCommand
    })).toBe(true)
    expect(SKILL_TEMPLATES.some((template) => {
      return template.modelInvocable
    })).toBe(true)
  })

  it.each(SKILL_TEMPLATES.map((template) => {
    return [template.id, template] as const
  }))('%s passes the importer analysis with no findings', async (_id, template) => {
    const analysis = await analyseSkillFiles({
      files: toAnalysisFiles(template.files),
      folderName: null,
    })

    expect(analysis.ok).toBe(true)

    if (!analysis.ok) {
      return
    }

    expect(analysis.findings).toEqual([])
    expect(analysis.findingCounts).toEqual({})
    expect(analysis.warnings).toEqual([])
    expect(analysis.skill.name).toBe(template.name)
    expect(analysis.skill.description).toBe(template.description)
    expect(analysis.licence.class).toBe('none')
  })

  it.each(SKILL_TEMPLATES.map((template) => {
    return [template.id, template] as const
  }))('%s has a usable name and valid file paths', (_id, template) => {
    expect(isReservedSkillSlashName(template.name)).toBe(false)
    expect(validateSkillSlashName(template.name).valid).toBe(true)

    for (const file of template.files) {
      expect(validateSkillEditPath(file.path)).toBeNull()
      expect(file.content.endsWith('\n')).toBe(true)
    }
  })

  it.each(SKILL_TEMPLATES.filter((template) => {
    return template.slashCommand
  }).map((template) => {
    return [template.id, template] as const
  }))('%s uses $ARGUMENTS and has an argument hint', (_id, template) => {
    expect(template.files[0]!.content).toContain('$ARGUMENTS')
    expect(template.argumentHint).toBeTruthy()
  })

  it('finds a template by id', () => {
    expect(getSkillTemplate('meeting-notes')?.name).toBe('meeting-notes')
    expect(getSkillTemplate('nope')).toBeNull()
  })
})

describe('buildBlankSkillFiles', () => {
  it.each(['skill', 'command'] as const)('builds a valid %s', async (kind) => {
    const files = buildBlankSkillFiles({
      name: 'my-skill',
      description: BLANK_SKILL_DESCRIPTION,
      kind,
    })
    const analysis = await analyseSkillFiles({
      files: toAnalysisFiles(files),
      folderName: null,
    })

    expect(files).toHaveLength(1)
    expect(analysis.ok).toBe(true)
    expect(files[0]!.content.includes('$ARGUMENTS')).toBe(kind === 'command')
  })

  it.each([
    'Plain description',
    'A colon: inside, and "quotes" and \'single\'',
    '# starts with a hash',
    '- starts with a dash',
    'Ends with a colon:',
    'yes',
    'null',
    '123',
    'Line one\nLine two',
    'Кирилиця: опис навички',
    '{braces} and [brackets] & ampersand *star',
  ])('round-trips the description %j through the parser', (description) => {
    const [file] = buildBlankSkillFiles({
      name: 'my-skill',
      description,
      kind: 'skill',
    })
    const parsed = parseSkillMarkdown(file!.content)

    expect(parsed.ok).toBe(true)

    if (parsed.ok) {
      expect(parsed.frontmatter.name).toBe('my-skill')
      expect(parsed.frontmatter.description).toBe(description.trim())
    }
  })
})
