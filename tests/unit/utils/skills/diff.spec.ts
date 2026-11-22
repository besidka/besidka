import { describe, expect, it } from 'vitest'
import {
  SKILL_DIFF_FILE_MAX_LINES,
  diffSkillFiles,
} from '#shared/utils/skills/diff'

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries))
}

describe('diffSkillFiles', () => {
  it('reports added, removed and modified files and skips equal ones', () => {
    const diff = diffSkillFiles(
      files({ 'a.md': 'one\n', 'b.md': 'same\n', 'gone.md': 'bye\n' }),
      files({ 'a.md': 'two\n', 'b.md': 'same\n', 'new.md': 'hi\n' }),
    )

    expect(diff.files.map((file) => {
      return [file.path, file.status]
    })).toEqual([
      ['a.md', 'modified'],
      ['gone.md', 'removed'],
      ['new.md', 'added'],
    ])
    expect(diff.unchanged).toBe(1)
    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(2)
  })

  it('keeps three lines of context and marks the gap', () => {
    const before = Array.from({ length: 30 }, (_, index) => {
      return `line ${index}`
    })
    const after = [...before]

    after[15] = 'changed'

    const [file] = diffSkillFiles(
      files({ 'a.md': `${before.join('\n')}\n` }),
      files({ 'a.md': `${after.join('\n')}\n` }),
    ).files

    expect(file!.lines.map((line) => {
      return line.kind
    })).toEqual([
      'gap',
      'context',
      'context',
      'context',
      'remove',
      'add',
      'context',
      'context',
      'context',
      'gap',
    ])
    expect(file!.lines[0]!.text).toBe('12 unchanged lines')
  })

  it('finds a minimal edit in the middle of a file', () => {
    const [file] = diffSkillFiles(
      files({ 'a.md': 'a\nb\nc\nd\n' }),
      files({ 'a.md': 'a\nx\nb\nc\nd\n' }),
    ).files

    expect(file!.added).toBe(1)
    expect(file!.removed).toBe(0)
  })

  it('stops emitting lines past the total cap and says so', () => {
    const big = (prefix: string) => {
      return Array.from({ length: 100 }, (_, index) => {
        return `${prefix} ${index}`
      }).join('\n')
    }
    const diff = diffSkillFiles(
      files({ 'a.md': big('a-old'), 'b.md': big('b-old') }),
      files({ 'a.md': big('a-new'), 'b.md': big('b-new') }),
      150,
    )
    const emitted = diff.files.reduce((total, file) => {
      return total + file.lines.length
    }, 0)

    expect(emitted).toBe(150)
    expect(diff.truncated).toBe(true)
    expect(diff.files).toHaveLength(2)
    expect(diff.files[1]!.lines.length).toBeLessThan(200)
  })

  it('reports a huge file by counts only instead of diffing it', () => {
    const huge = Array.from({ length: SKILL_DIFF_FILE_MAX_LINES + 1 }, () => {
      return 'x'
    }).join('\n')
    const [file] = diffSkillFiles(
      files({ 'a.md': huge }),
      files({ 'a.md': `${huge}\ny` }),
    ).files

    expect(file).toMatchObject({ lines: [], truncated: true })
  })

  it('switches to counts only once the running cell budget is spent', () => {
    const lines = (prefix: string, shared: number) => {
      return Array.from({ length: 1100 }, (_, index) => {
        return index < shared ? `same ${index}` : `${prefix}${index}`
      }).join('\n')
    }
    const before = new Map<string, string>()
    const after = new Map<string, string>()

    for (let file = 0; file < 8; file++) {
      before.set(`f${file}.md`, `head\n${lines('a', 0)}\ntail`)
      after.set(`f${file}.md`, `head\n${lines('b', 0)}\ntail`)
    }

    const diff = diffSkillFiles(before, after, 100_000)
    const withLines = diff.files.filter((file) => {
      return file.lines.length > 0
    })
    const countsOnly = diff.files.filter((file) => {
      return file.lines.length === 0
    })

    expect(withLines.length).toBeGreaterThan(0)
    expect(countsOnly.length).toBeGreaterThan(0)
    expect(countsOnly.every((file) => {
      return file.truncated && file.added === 1102 && file.removed === 1102
    })).toBe(true)
    expect(diff.truncated).toBe(true)
  })

  it('replaces wholesale when the diff table would be too large', () => {
    const lines = (prefix: string) => {
      return Array.from({ length: 1900 }, (_, index) => {
        return `${prefix}${index}`
      }).join('\n')
    }
    const [file] = diffSkillFiles(
      files({ 'a.md': lines('a') }),
      files({ 'a.md': lines('b') }),
    ).files

    expect(file!.added).toBe(1900)
    expect(file!.removed).toBe(1900)
  })
})
