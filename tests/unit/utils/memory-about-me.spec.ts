import { describe, expect, it } from 'vitest'
import { buildAboutMeDescription } from '#shared/utils/memory-about-me'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'

const limit = MEMORY_LIMITS.maxDescriptionChars

describe('buildAboutMeDescription', () => {
  it('uses the first non-empty line', () => {
    expect(buildAboutMeDescription('\n  \nBackend dev.\nSecond line.'))
      .toBe('Backend dev.')
  })

  it('collapses inner whitespace to a single line', () => {
    expect(buildAboutMeDescription('Backend \t  dev')).toBe('Backend dev')
  })

  it('keeps a line of exactly the limit untouched', () => {
    const line = 'a'.repeat(limit)

    expect(buildAboutMeDescription(line)).toBe(line)
  })

  it('cuts a longer line at the last word boundary with an ellipsis', () => {
    const description = buildAboutMeDescription(
      `${'word '.repeat(30)}tail`,
    )

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description.endsWith('word…')).toBe(true)
    expect(description).not.toContain('\n')
  })

  it('hard-cuts a long line without spaces', () => {
    const description = buildAboutMeDescription('я'.repeat(300))

    expect(description).toBe(`${'я'.repeat(limit - 1)}…`)
  })

  it('does not leave half of a surrogate pair', () => {
    const description = buildAboutMeDescription('😀'.repeat(100))

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description).not.toMatch(/[\uD800-\uDBFF]…$/)
  })

  it('splits on unicode line separators', () => {
    expect(buildAboutMeDescription(`${'a'.repeat(limit - 1)}\u2028second`))
      .toBe('a'.repeat(limit - 1))
  })

  it('falls back when there is no text', () => {
    expect(buildAboutMeDescription('  \n ')).toBe(
      'Things I wrote about myself',
    )
    expect(buildAboutMeDescription('')).toBe('Things I wrote about myself')
  })
})
