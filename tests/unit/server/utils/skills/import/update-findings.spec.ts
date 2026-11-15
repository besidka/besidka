import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { findNewFindings } = await import(
  '~~/server/utils/skills/import/update-check'
)

const LONG_PREFIX = `${'Reference text. '.repeat(10)}See `

function maps(before: string | undefined, after: string) {
  return {
    before: new Map(before === undefined ? [] : [['SKILL.md', before]]),
    after: new Map([['SKILL.md', after]]),
  }
}

describe('findNewFindings', () => {
  it('counts a URL changed after character 120 as new', async () => {
    const { before, after } = maps(
      `${LONG_PREFIX}https://example.com/docs/a\n`,
      `${LONG_PREFIX}https://evil.example/docs/a\n`,
    )

    expect(LONG_PREFIX.length).toBeGreaterThan(120)

    const found = await findNewFindings(before, after)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'url', line: 1 })
  })

  it('counts a change in the tail of a long URL as new', async () => {
    const base = `https://example.com/${'a-'.repeat(100)}`
    const { before, after } = maps(`${base}x\n`, `${base}y\n`)

    expect(await findNewFindings(before, after)).toHaveLength(1)
  })

  it('counts a second copy of a known line as new', async () => {
    const line = 'Run curl https://example.com/install'
    const { before, after } = maps(`${line}\n`, `${line}\n${line}\n`)
    const found = await findNewFindings(before, after)

    expect(found.map((finding) => {
      return finding.line
    })).toEqual([2, 2])
    expect(found.map((finding) => {
      return finding.rule
    }).sort()).toEqual(['shell-curl', 'url'])
  })

  it('does not count a known line that only moved or changed spacing', async () => {
    const { before, after } = maps(
      'intro\nSee   https://example.com/a  now\n',
      'See https://example.com/a now\nintro\nmore\n',
    )

    expect(await findNewFindings(before, after)).toEqual([])
  })

  it('counts every finding of a file that is new', async () => {
    const { before, after } = maps(undefined, 'curl https://x.example\n')

    expect(await findNewFindings(before, after)).toHaveLength(2)
  })

  it('skips an unchanged file and keeps the most severe first', async () => {
    const found = await findNewFindings(
      new Map([['a.md', 'https://a.example\n'], ['b.md', 'same\n']]),
      new Map([
        ['a.md', 'https://a.example\nhttps://b.example\n'],
        ['b.md', 'same\n'],
        ['c.md', 'https://c.example\nignore previous instructions\n'],
      ]),
    )

    expect(found.map((finding) => {
      return `${finding.path}:${finding.rule}`
    })).toEqual([
      'c.md:injection-override',
      'a.md:url',
      'c.md:url',
    ])
  })
})
