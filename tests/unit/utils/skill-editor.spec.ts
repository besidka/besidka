import { describe, expect, it } from 'vitest'
import {
  buildSkillEditorChanges,
  findAdvancedYamlIssue,
  findHiddenCharacterProblems,
  getSkillEditorByteLength,
  getSkillEditorDescriptionError,
  getSkillEditorFileBytes,
  getSkillEditorNameError,
  getSkillEditorSaveBlockers,
  isSkillEditorMarkdownPath,
  isSkillEditorNameTaken,
  removeSkillHiddenCharacters,
  validateSkillEditorPath,
} from '../../../app/utils/skill-editor'
import type { SkillEditorFile } from '../../../app/utils/skill-editor'

function createFile(
  path: string,
  overrides: Partial<SkillEditorFile> = {},
): SkillEditorFile {
  return {
    key: `file:${path}`,
    originalPath: path,
    path,
    bytes: 10,
    text: null,
    originalText: null,
    loadState: 'idle',
    loadError: '',
    isDeleted: false,
    isLocked: false,
    isTooLarge: false,
    ...overrides,
  }
}

function createNewFile(
  path: string,
  text = '',
): SkillEditorFile {
  return createFile(path, {
    key: `new:${path}`,
    originalPath: null,
    bytes: 0,
    text,
    loadState: 'ready',
  })
}

describe('validateSkillEditorPath', () => {
  const files = [
    createFile('SKILL.md'),
    createFile('references/guide.md'),
    createFile('LICENSE.txt', { isLocked: true }),
  ]

  it('accepts a plain relative path with an allowed extension', () => {
    expect(validateSkillEditorPath('references/new.md', {
      files,
      filesLocked: false,
    })).toBeNull()
  })

  it('applies the import path rules', () => {
    expect(validateSkillEditorPath('../escape.md', {
      files,
      filesLocked: false,
    })).toBeTruthy()
    expect(validateSkillEditorPath('tool.exe', {
      files,
      filesLocked: false,
    })).toBeTruthy()
    expect(validateSkillEditorPath('/absolute.md', {
      files,
      filesLocked: false,
    })).toBeTruthy()
  })

  it('refuses a name that exists, without regard to case', () => {
    expect(validateSkillEditorPath('References/Guide.md', {
      files,
      filesLocked: false,
    })).toContain('exists')
    expect(validateSkillEditorPath('skill.md', {
      files,
      filesLocked: false,
    })).toContain('exists')
  })

  it('allows a case-only rename of the file itself', () => {
    expect(validateSkillEditorPath('references/GUIDE.md', {
      files,
      filesLocked: false,
      editingKey: 'file:references/guide.md',
    })).toBeNull()
  })

  it('refuses a rename onto the original path of a renamed file', () => {
    const renamed = [
      createFile('a.md', { path: 'c.md' }),
      createFile('b.md'),
    ]

    expect(validateSkillEditorPath('a.md', {
      files: renamed,
      filesLocked: false,
      editingKey: 'file:b.md',
    })).toContain('exists')
  })

  it('allows reusing the path of a file that was deleted', () => {
    const withDeleted = [
      createFile('SKILL.md'),
      createFile('old.md', { isDeleted: true }),
    ]

    expect(validateSkillEditorPath('old.md', {
      files: withDeleted,
      filesLocked: false,
    })).toBeNull()
  })

  it('refuses a root licence name while licence files are locked', () => {
    expect(validateSkillEditorPath('NOTICE.md', {
      files,
      filesLocked: true,
    })).toContain('Licence files')
    expect(validateSkillEditorPath('NOTICE.md', {
      files,
      filesLocked: false,
    })).toBeNull()
  })
})

describe('buildSkillEditorChanges', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildSkillEditorChanges([
      createFile('SKILL.md', { text: 'a', originalText: 'a' }),
      createFile('b.md'),
    ])).toEqual([])
  })

  it('puts a changed file at its path', () => {
    expect(buildSkillEditorChanges([
      createFile('SKILL.md', { text: 'b', originalText: 'a' }),
    ])).toEqual([{ op: 'put', path: 'SKILL.md', content: 'b' }])
  })

  it('deletes first, then renames, then puts at the final paths', () => {
    expect(buildSkillEditorChanges([
      createNewFile('new.md', 'hello'),
      createFile('moved.md', {
        originalPath: 'old.md',
        text: 'edited',
        originalText: 'original',
      }),
      createFile('gone.md', { isDeleted: true }),
    ])).toEqual([
      { op: 'delete', path: 'gone.md' },
      { op: 'rename', from: 'old.md', to: 'moved.md' },
      { op: 'put', path: 'new.md', content: 'hello' },
      { op: 'put', path: 'moved.md', content: 'edited' },
    ])
  })

  it('renames a file that was never opened without sending its content', () => {
    expect(buildSkillEditorChanges([
      createFile('b.md', { originalPath: 'a.md' }),
    ])).toEqual([{ op: 'rename', from: 'a.md', to: 'b.md' }])
  })

  it('leaves no trace of a new file that was deleted again', () => {
    expect(buildSkillEditorChanges([
      { ...createNewFile('temp.md', 'x'), isDeleted: true },
    ])).toEqual([])
  })

  it('puts a new file even when it is empty', () => {
    expect(buildSkillEditorChanges([createNewFile('empty.md')]))
      .toEqual([{ op: 'put', path: 'empty.md', content: '' }])
  })

  it('puts new content at a path whose original was deleted', () => {
    expect(buildSkillEditorChanges([
      createFile('a.md', { isDeleted: true }),
      createNewFile('a.md', 'again'),
    ])).toEqual([
      { op: 'delete', path: 'a.md' },
      { op: 'put', path: 'a.md', content: 'again' },
    ])
  })
})

describe('getSkillEditorSaveBlockers', () => {
  it('is empty for a small save', () => {
    const files = [createFile('SKILL.md', { text: 'b', originalText: 'a' })]

    expect(getSkillEditorSaveBlockers(files, buildSkillEditorChanges(files)))
      .toEqual([])
  })

  it('names a file over the editor cap', () => {
    const files = [createNewFile('big.md', 'x'.repeat(256 * 1024 + 1))]
    const blockers = getSkillEditorSaveBlockers(
      files,
      buildSkillEditorChanges(files),
    )

    expect(blockers.some(blocker => blocker.includes('big.md'))).toBe(true)
  })

  it('counts bytes, not characters', () => {
    const text = 'я'.repeat(140 * 1024)
    const files = [createNewFile('wide.md', text)]

    expect(getSkillEditorByteLength(text)).toBe(280 * 1024)
    expect(getSkillEditorSaveBlockers(files, buildSkillEditorChanges(files)))
      .toHaveLength(1)
  })

  it('refuses more than 50 changes in one save', () => {
    const files = Array.from({ length: 51 }, (_, index) => {
      return createNewFile(`f${index}.md`, 'x')
    })

    expect(getSkillEditorSaveBlockers(files, buildSkillEditorChanges(files))
      .some(blocker => blocker.includes('50'))).toBe(true)
  })

  it('refuses binary content', () => {
    const files = [createNewFile('bin.md', 'a\u0000b')]

    expect(getSkillEditorSaveBlockers(files, buildSkillEditorChanges(files))
      .some(blocker => blocker.includes('binary'))).toBe(true)
  })
})

describe('getSkillEditorFileBytes', () => {
  it('uses the stored size until the text changes', () => {
    expect(getSkillEditorFileBytes(createFile('a.md', {
      bytes: 99,
      text: 'same',
      originalText: 'same',
    }))).toBe(99)
    expect(getSkillEditorFileBytes(createFile('a.md', {
      bytes: 99,
      text: 'changed',
      originalText: 'same',
    }))).toBe(7)
  })
})

describe('name and description rules', () => {
  it('requires a valid name', () => {
    expect(getSkillEditorNameError('', { slashCommand: false })).toBe('Add a name')
    expect(getSkillEditorNameError('Bad Name', { slashCommand: false }))
      .toContain('lowercase')
    expect(getSkillEditorNameError('review-pr', { slashCommand: false })).toBe('')
  })

  it('refuses a reserved name only while the command toggle is on', () => {
    expect(getSkillEditorNameError('help', { slashCommand: true }))
      .toContain('reserved')
    expect(getSkillEditorNameError('help', { slashCommand: false })).toBe('')
  })

  it('finds a name taken by another skill', () => {
    const skills = [{ id: 'a', name: 'alpha' }, { id: 'b', name: 'beta' }]

    expect(isSkillEditorNameTaken('beta', 'a', skills)).toBe(true)
    expect(isSkillEditorNameTaken('alpha', 'a', skills)).toBe(false)
    expect(isSkillEditorNameTaken('gamma', 'a', skills)).toBe(false)
  })

  it('requires a description of at most 1,024 characters', () => {
    expect(getSkillEditorDescriptionError('  ')).toContain('Add a description')
    expect(getSkillEditorDescriptionError('x'.repeat(1025))).toContain('1024')
    expect(getSkillEditorDescriptionError('ok')).toBe('')
  })
})

describe('findAdvancedYamlIssue', () => {
  it('is null for valid or empty YAML', () => {
    expect(findAdvancedYamlIssue('')).toBeNull()
    expect(findAdvancedYamlIssue('license: MIT')).toBeNull()
  })

  it('reports the line of the error', () => {
    const issue = findAdvancedYamlIssue('license: MIT\nmetadata: [oops')

    expect(issue?.line).toBe(2)
    expect(issue?.message).toBeTruthy()
  })
})

describe('hidden characters', () => {
  it('lists one problem per line with the line number', () => {
    const problems = findHiddenCharacterProblems(
      'clean\nbad‮​line\nclean',
      'body',
    )

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      line: 2,
      scope: 'body',
      severity: 'warning',
      fix: 'remove-hidden-characters',
    })
    expect(problems[0]!.message).toContain('2 hidden characters')
  })

  it('removes every hidden character', () => {
    expect(removeSkillHiddenCharacters('a‮b​c')).toBe('abc')
  })
})

describe('isSkillEditorMarkdownPath', () => {
  it('recognises markdown files', () => {
    expect(isSkillEditorMarkdownPath('SKILL.md')).toBe(true)
    expect(isSkillEditorMarkdownPath('scripts/run.py')).toBe(false)
  })
})
