import { describe, expect, it } from 'vitest'
import {
  getSkillSourceGroup,
  isSkillLicenceRootFile,
  validateSkillEditPath,
} from '#shared/utils/skills/edit'
import { SKILL_SOURCE_KINDS } from '#shared/utils/skills-policy'

describe('validateSkillEditPath', () => {
  it.each([
    'SKILL.md',
    'references/guide.md',
    'scripts/run.py',
    'LICENSE',
    'NOTICE.txt',
    'a/b/c/d/e/f.md',
  ])('accepts %s', (path) => {
    expect(validateSkillEditPath(path)).toBeNull()
  })

  it.each([
    '',
    '/abs.md',
    '../up.md',
    'a/../b.md',
    './a.md',
    'a//b.md',
    'dir/',
    'back\\slash.md',
    'tool.exe',
    'image.png',
    'noextension',
    'trailing-dot.',
    'dir /a.md',
    'a:b.md',
    'a/b/c/d/e/f/g.md',
    `${'a'.repeat(200)}.md`,
    'hidden‮.md',
    'control\u0007.md',
  ])('rejects %j', (path) => {
    expect(validateSkillEditPath(path)).toEqual(expect.any(String))
  })

  it('rejects a path that is not in its normalised form', () => {
    expect(validateSkillEditPath('é.md')).toEqual(expect.any(String))
  })
})

describe('isSkillLicenceRootFile', () => {
  it.each(['LICENSE', 'LICENSE.md', 'licence.txt', 'COPYING', 'NOTICE'])(
    'treats %s at the root as a licence file',
    (path) => {
      expect(isSkillLicenceRootFile(path)).toBe(true)
    },
  )

  it.each(['references/LICENSE', 'license-notes.md', 'SKILL.md'])(
    'does not treat %s as one',
    (path) => {
      expect(isSkillLicenceRootFile(path)).toBe(false)
    },
  )
})

describe('getSkillSourceGroup', () => {
  it('groups every source kind', () => {
    expect(Object.fromEntries(SKILL_SOURCE_KINDS.map((kind) => {
      return [kind, getSkillSourceGroup(kind)]
    }))).toEqual({
      editor: 'created',
      template: 'created',
      zip: 'imported',
      text: 'imported',
      github: 'imported',
      url: 'imported',
      mcp: 'apps',
      share: 'imported',
    })
  })
})
