import { describe, expect, it } from 'vitest'
import {
  checkSkillRelativePath,
  detectSkillRoot,
  getSkillFileKind,
  normaliseSkillEntryName,
} from '#shared/utils/skills/path'

describe('normaliseSkillEntryName', () => {
  it('accepts a plain relative path and NFC-normalises it', () => {
    expect(normaliseSkillEntryName('skill/references/a.md')).toEqual({
      status: 'ok',
      path: 'skill/references/a.md',
    })
    expect(normaliseSkillEntryName('skill/cafe\u0301.md')).toEqual({
      status: 'ok',
      path: 'skill/caf\u00E9.md',
    })
  })

  it.each([
    ['../../evil.md', 'traversal'],
    ['skill/../../evil.md', 'traversal'],
    ['/etc/passwd', 'absolute'],
    ['C:/win.md', 'absolute'],
    ['skill\\win.md', 'backslash'],
    ['skill/a\u0000.md', 'control-character'],
    ['skill/a\u0007.md', 'control-character'],
    ['skill/\u202Eevil.md', 'format-character'],
    ['skill/a\u200B.md', 'format-character'],
    ['skill/a\u00AD.md', 'format-character'],
    ['skill/a\u2060.md', 'format-character'],
    ['skill/a\u061C.md', 'format-character'],
    ['skill/a\u3164.md', 'format-character'],
    ['skill/a\uFE0F.md', 'format-character'],
    ['skill/a\u{E0041}.md', 'format-character'],
    ['skill/a\u2028.md', 'format-character'],
    ['skill/name.', 'unsafe-segment'],
    ['skill/name.md.', 'unsafe-segment'],
    ['skill/name.md ', 'unsafe-segment'],
    ['skill/dir /file.md', 'unsafe-segment'],
    ['skill/dir./file.md', 'unsafe-segment'],
    ['skill/file.md:stream', 'unsafe-segment'],
    ['skill/a:b/file.md', 'unsafe-segment'],
    ['skill/.../file.md', 'unsafe-segment'],
    ['', 'empty'],
  ])('rejects %j as %s', (name, reason) => {
    expect(normaliseSkillEntryName(name)).toEqual({ status: 'reject', reason })
  })

  it('skips directories, macOS metadata and .DS_Store', () => {
    expect(normaliseSkillEntryName('skill/')).toEqual({
      status: 'skip',
      reason: 'directory',
    })
    expect(normaliseSkillEntryName('__MACOSX/skill/._SKILL.md')).toEqual({
      status: 'skip',
      reason: 'macos-metadata',
    })
    expect(normaliseSkillEntryName('skill/.DS_Store')).toEqual({
      status: 'skip',
      reason: 'ds-store',
    })
    expect(normaliseSkillEntryName('skill/references/._checklist.md'))
      .toEqual({ status: 'skip', reason: 'macos-metadata' })
  })
})

describe('checkSkillRelativePath', () => {
  it('allows the text allowlist and licence files with or without extension', () => {
    for (const path of [
      'SKILL.md',
      'scripts/run.py',
      'data.csv',
      'LICENSE',
      'LICENSE.txt',
      'NOTICE',
      'COPYING',
      'LICENCE.md',
    ]) {
      expect(checkSkillRelativePath(path)).toBeNull()
    }
  })

  it.each(['a.pyc', 'a.so', 'a.dll', 'a.exe', 'a.bin', 'A.CLASS', 'a.jar', 'a.wasm'])(
    'denies %s',
    (path) => {
      expect(checkSkillRelativePath(path)).toBe('extension-denied')
    },
  )

  it('rejects files outside the allowlist', () => {
    expect(checkSkillRelativePath('logo.png')).toBe('extension-not-allowed')
    expect(checkSkillRelativePath('Makefile')).toBe('extension-not-allowed')
  })

  it('enforces the length and depth limits', () => {
    expect(checkSkillRelativePath(`${'a'.repeat(198)}.md`)).toBe('too-long')
    expect(checkSkillRelativePath('a/b/c/d/e/f.md')).toBeNull()
    expect(checkSkillRelativePath('a/b/c/d/e/f/g.md')).toBe('too-deep')
  })
})

describe('detectSkillRoot', () => {
  it('prefers SKILL.md at the archive root', () => {
    expect(detectSkillRoot(['SKILL.md', 'other/SKILL.md'])).toEqual({
      ok: true,
      root: '',
      folderName: null,
    })
  })

  it('uses the single top-level folder that holds SKILL.md', () => {
    expect(detectSkillRoot(['review/SKILL.md', 'review/a.md'])).toEqual({
      ok: true,
      root: 'review/',
      folderName: 'review',
    })
  })

  it('rejects two candidate roots and a missing SKILL.md', () => {
    expect(detectSkillRoot(['a/SKILL.md', 'b/SKILL.md'])).toEqual({
      ok: false,
      code: 'ambiguous-root',
    })
    expect(detectSkillRoot(['a/deep/SKILL.md', 'README.md'])).toEqual({
      ok: false,
      code: 'missing-skill-md',
    })
  })
})

describe('getSkillFileKind', () => {
  it('classifies files by name and folder', () => {
    expect(getSkillFileKind('SKILL.md')).toBe('skill-md')
    expect(getSkillFileKind('LICENSE.txt')).toBe('licence')
    expect(getSkillFileKind('NOTICE')).toBe('licence')
    expect(getSkillFileKind('scripts/run.sh')).toBe('script')
    expect(getSkillFileKind('references/a.md')).toBe('reference')
    expect(getSkillFileKind('assets/t.json')).toBe('asset')
    expect(getSkillFileKind('helper.py')).toBe('script')
    expect(getSkillFileKind('notes.md')).toBe('other')
  })
})
