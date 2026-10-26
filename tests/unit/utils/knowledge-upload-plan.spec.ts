import { describe, expect, it } from 'vitest'
import {
  isIgnoredByGitignore,
  knowledgeSkipReasonLabels,
  parseSimpleGitignore,
  planKnowledgeUpload,
  summarizeKnowledgePlan,
} from '~/utils/knowledge-upload-plan'
import type { KnowledgePlanEntry } from '~/utils/knowledge-upload-plan'
import { sha256Hex } from '~/utils/knowledge-hash'

const MEGABYTE = 1024 * 1024

function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' })
}

function sizedFile(name: string, bytes: number, fill: number = 1): File {
  return new File([new Uint8Array(bytes).fill(fill)], name)
}

function entry(file: File, relativePath: string | null): KnowledgePlanEntry {
  return { file, relativePath }
}

function plan(
  entries: KnowledgePlanEntry[],
  options: { gitignoreText?: string, existingHashes?: string[] } = {},
) {
  return planKnowledgeUpload({
    entries,
    gitignoreText: options.gitignoreText ?? '',
    existingHashes: options.existingHashes ?? [],
  })
}

describe('parseSimpleGitignore', () => {
  it('ignores comments, blank lines and negations', () => {
    const rules = parseSimpleGitignore(
      '# comment\n\n   \n!keep.txt\n*.log\n',
    )

    expect(rules).toHaveLength(1)
    expect(isIgnoredByGitignore(rules, 'keep.txt')).toBe(false)
    expect(isIgnoredByGitignore(rules, 'debug.log')).toBe(true)
  })

  it('matches directory patterns through descendants only for directories', () => {
    const rules = parseSimpleGitignore('coverage/')

    expect(isIgnoredByGitignore(rules, 'coverage/lcov.info')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'packages/app/coverage/a.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'coverage', true)).toBe(true)
    expect(isIgnoredByGitignore(rules, 'coverage')).toBe(false)
  })

  it('matches extension globs at any depth', () => {
    const rules = parseSimpleGitignore('*.min.js')

    expect(isIgnoredByGitignore(rules, 'app.min.js')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'a/b/app.min.js')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'app.js')).toBe(false)
  })

  it('anchors rooted and slash-containing patterns to the root', () => {
    const rooted = parseSimpleGitignore('/secrets.txt')
    const nested = parseSimpleGitignore('docs/*.md')

    expect(isIgnoredByGitignore(rooted, 'secrets.txt')).toBe(true)
    expect(isIgnoredByGitignore(rooted, 'a/secrets.txt')).toBe(false)
    expect(isIgnoredByGitignore(nested, 'docs/readme.md')).toBe(true)
    expect(isIgnoredByGitignore(nested, 'docs/deep/readme.md')).toBe(false)
    expect(isIgnoredByGitignore(nested, 'a/docs/readme.md')).toBe(false)
  })

  it('matches plain names as files or directories at any depth', () => {
    const rules = parseSimpleGitignore('tmp')

    expect(isIgnoredByGitignore(rules, 'tmp')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'a/tmp/b.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'tmpfile.txt')).toBe(false)
  })

  it('supports double-star globs and the single-character wildcard', () => {
    const rules = parseSimpleGitignore('**/cache\na/**/z.txt\nfile?.txt')

    expect(isIgnoredByGitignore(rules, 'x/y/cache/data.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'cache/data.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'a/b/c/z.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'a/z.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'file1.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'file12.txt')).toBe(false)
  })

  it('handles CRLF line endings and trailing spaces', () => {
    const rules = parseSimpleGitignore('build-output  \r\n*.tmp\r\n')

    expect(isIgnoredByGitignore(rules, 'build-output/a.txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'x.tmp')).toBe(true)
  })

  it('escapes regex metacharacters in names', () => {
    const rules = parseSimpleGitignore('a+b(1).txt')

    expect(isIgnoredByGitignore(rules, 'a+b(1).txt')).toBe(true)
    expect(isIgnoredByGitignore(rules, 'aab1.txt')).toBe(false)
  })
})

describe('planKnowledgeUpload classification', () => {
  it('accepts supported files with category and SHA-256', async () => {
    const result = await plan([
      entry(textFile('notes.md', '# Notes'), null),
      entry(sizedFile('doc.pdf', 10), null),
      entry(sizedFile('shot.png', 10, 2), null),
    ])

    expect(result.accepted.map(item => item.category)).toEqual([
      'text',
      'document',
      'image',
    ])
    expect(result.accepted[0]?.contentHash).toBe(
      await sha256Hex(new TextEncoder().encode('# Notes')),
    )
    expect(result.skipped).toEqual([])
    expect(result.totalBytes).toBe(7 + 10 + 10)
  })

  it('skips built-in ignored paths before anything else', async () => {
    const result = await plan([
      entry(textFile('index.js', 'a'), 'node_modules/pkg/index.js'),
      entry(textFile('pnpm-lock.yaml', 'a'), 'pnpm-lock.yaml'),
      entry(textFile('.DS_Store', 'a'), '.DS_Store'),
    ])

    expect(result.accepted).toEqual([])
    expect(result.skipped.map(item => item.reason)).toEqual([
      'ignored-path',
      'ignored-path',
      'ignored-path',
    ])
  })

  it.each([
    ['a backslash', 'dir\\a.md', 'Path must not contain backslashes'],
    [
      'a leading slash',
      '/abs/b.md',
      'Path must not start or end with a slash or contain empty segments',
    ],
    [
      'a trailing slash',
      'dir/b.md/',
      'Path must not start or end with a slash or contain empty segments',
    ],
    [
      'an empty segment',
      'dir//c.md',
      'Path must not start or end with a slash or contain empty segments',
    ],
    [
      'a parent segment',
      'a/../d.md',
      'Path must not contain "." or ".." segments',
    ],
    [
      'a control character',
      'dir/e\u0007.md',
      'Path must be a single line without control characters',
    ],
    [
      'more than 512 characters',
      `${'d/'.repeat(300)}f.md`,
      'Path must be at most 512 characters',
    ],
  ])('skips a path with %s and carries the issue', async (_label, path, issue) => {
    const result = await plan([
      entry(textFile('x.md', 'one'), path),
      entry(textFile('f.md', 'six'), 'ok/f.md'),
    ])

    expect(result.accepted.map(item => item.relativePath)).toEqual(['ok/f.md'])
    expect(result.skipped).toEqual([
      {
        name: 'x.md',
        relativePath: path,
        reason: 'invalid-path',
        detail: issue,
      },
    ])
    expect(summarizeKnowledgePlan(result).details).toEqual([
      { path, issue },
    ])
  })

  it('leaves details out of the summary when every path is valid', async () => {
    const result = await plan([entry(textFile('a.md', 'one'), 'ok/a.md')])

    expect(summarizeKnowledgePlan(result)).not.toHaveProperty('details')
  })

  it('stores the NFC form of an accepted path', async () => {
    const result = await plan([
      entry(textFile('e.md', 'one'), 'cafe\u0301/e\u0301.md'),
    ])

    expect(result.accepted[0]?.relativePath).toBe('caf\u00E9/\u00E9.md')
  })

  it('keeps null relative paths for plain uploads', async () => {
    const result = await plan([entry(textFile('plain.md', 'one'), null)])

    expect(result.accepted[0]?.relativePath).toBeNull()
  })

  it('applies the root .gitignore subset to relative paths', async () => {
    const result = await plan(
      [
        entry(textFile('a.log', 'one'), 'logs/a.log'),
        entry(textFile('keep.md', 'two'), 'docs/keep.md'),
        entry(textFile('gen.ts', 'three'), 'src/generated/gen.ts'),
      ],
      { gitignoreText: '*.log\ngenerated/\n' },
    )

    expect(result.accepted.map(item => item.relativePath)).toEqual([
      'docs/keep.md',
    ])
    expect(result.skipped.map(item => item.reason)).toEqual([
      'gitignore',
      'gitignore',
    ])
  })

  it('skips unsupported extensions', async () => {
    const result = await plan([
      entry(textFile('archive.zip', 'x'), null),
      entry(textFile('LICENSE', 'x'), null),
      entry(textFile('.gitignore', 'x'), null),
    ])

    expect(result.skipped.map(item => item.reason)).toEqual([
      'unsupported',
      'unsupported',
      'unsupported',
    ])
  })

  it('applies per-category size limits', async () => {
    const result = await plan([
      entry(sizedFile('big.txt', MEGABYTE + 1), null),
      entry(sizedFile('edge.txt', MEGABYTE, 2), null),
      entry(sizedFile('huge.pdf', 30 * MEGABYTE + 1), null),
      entry(sizedFile('large.pdf', 25 * MEGABYTE, 3), null),
    ])

    expect(result.skipped.map(item => item.name)).toEqual([
      'big.txt',
      'huge.pdf',
    ])
    expect(result.skipped.every(item => item.reason === 'too-large')).toBe(
      true,
    )
    expect(result.accepted.map(item => item.name)).toEqual([
      'edge.txt',
      'large.pdf',
    ])
  })

  it('sniffs NUL bytes in the first 8 KB of text files only', async () => {
    const headBinary = new Uint8Array(100).fill(0x61)
    const lateNul = new Uint8Array(9000).fill(0x61)

    headBinary[50] = 0
    lateNul[8500] = 0

    const result = await plan([
      entry(new File([headBinary], 'head.txt'), null),
      entry(new File([lateNul], 'late.txt'), null),
      entry(new File([new Uint8Array([1, 0, 2])], 'photo.png'), null),
    ])

    expect(result.skipped).toEqual([
      { name: 'head.txt', relativePath: null, reason: 'binary' },
    ])
    expect(result.accepted.map(item => item.name)).toEqual([
      'late.txt',
      'photo.png',
    ])
  })
})

describe('planKnowledgeUpload dedupe and caps', () => {
  it('skips duplicates within the batch and against existing hashes', async () => {
    const existingHash = await sha256Hex(new TextEncoder().encode('known'))

    const result = await plan(
      [
        entry(textFile('a.txt', 'same'), null),
        entry(textFile('b.txt', 'same'), null),
        entry(textFile('c.txt', 'known'), null),
        entry(textFile('d.txt', 'fresh'), null),
      ],
      { existingHashes: [existingHash] },
    )

    expect(result.accepted.map(item => item.name)).toEqual(['a.txt', 'd.txt'])
    expect(result.skipped).toEqual([
      { name: 'b.txt', relativePath: null, reason: 'duplicate' },
      { name: 'c.txt', relativePath: null, reason: 'duplicate' },
    ])
    expect(result.totalBytes).toBe(4 + 5)
  })

  it('accepts at most 500 files of a folder', async () => {
    const entries = Array.from({ length: 501 }, (_value, index) => {
      return entry(textFile(`f${index}.txt`, `content ${index}`), `d/f${index}.txt`)
    })

    const result = await plan(entries)

    expect(result.accepted).toHaveLength(500)
    expect(result.skipped).toEqual([
      { name: 'f500.txt', relativePath: 'd/f500.txt', reason: 'folder-limit' },
    ])
  })

  it('accepts at most 20 MB of a folder', async () => {
    const result = await plan([
      entry(sizedFile('a.pdf', 8 * MEGABYTE, 1), 'd/a.pdf'),
      entry(sizedFile('b.pdf', 8 * MEGABYTE, 2), 'd/b.pdf'),
      entry(sizedFile('c.pdf', 8 * MEGABYTE, 3), 'd/c.pdf'),
      entry(sizedFile('d.pdf', 4 * MEGABYTE, 4), 'd/d.pdf'),
      entry(sizedFile('e.pdf', 4 * MEGABYTE + 1, 5), 'd/e.pdf'),
    ])

    expect(result.accepted.map(item => item.name)).toEqual([
      'a.pdf',
      'b.pdf',
      'd.pdf',
    ])
    expect(result.skipped.map(item => item.name)).toEqual(['c.pdf', 'e.pdf'])
    expect(result.skipped.every(item => item.reason === 'folder-limit')).toBe(
      true,
    )
    expect(result.totalBytes).toBe(20 * MEGABYTE)
  })

  it('does not apply folder caps to plain file picks', async () => {
    const result = await plan([
      entry(sizedFile('a.pdf', 12 * MEGABYTE, 1), null),
      entry(sizedFile('b.pdf', 12 * MEGABYTE, 2), null),
    ])

    expect(result.accepted).toHaveLength(2)
    expect(result.totalBytes).toBe(24 * MEGABYTE)
  })

  it('does not count duplicates against the folder caps', async () => {
    const entries = [
      entry(textFile('a.txt', 'dup'), 'd/a.txt'),
      ...Array.from({ length: 5 }, (_value, index) => {
        return entry(textFile(`copy${index}.txt`, 'dup'), `d/copy${index}.txt`)
      }),
    ]

    const result = await plan(entries)

    expect(result.accepted).toHaveLength(1)
    expect(result.skipped.every(item => item.reason === 'duplicate')).toBe(true)
  })
})

describe('summarizeKnowledgePlan', () => {
  it('counts additions and skip reasons, most frequent first', async () => {
    const result = await plan([
      entry(textFile('ok.md', 'ok'), 'ok.md'),
      entry(textFile('a.zip', 'x'), 'a.zip'),
      entry(textFile('b.zip', 'x'), 'b.zip'),
      entry(textFile('i.js', 'x'), 'node_modules/i.js'),
    ])

    expect(summarizeKnowledgePlan(result)).toEqual({
      added: 1,
      skipped: 3,
      reasons: [
        {
          reason: 'unsupported',
          label: knowledgeSkipReasonLabels.unsupported,
          count: 2,
        },
        {
          reason: 'ignored-path',
          label: knowledgeSkipReasonLabels['ignored-path'],
          count: 1,
        },
      ],
    })
  })

  it('returns empty reasons when nothing was skipped', () => {
    expect(summarizeKnowledgePlan({ accepted: [], skipped: [] })).toEqual({
      added: 0,
      skipped: 0,
      reasons: [],
    })
  })

  it('has a human label for every reason', () => {
    expect(Object.keys(knowledgeSkipReasonLabels).sort()).toEqual([
      'binary',
      'duplicate',
      'folder-limit',
      'gitignore',
      'ignored-path',
      'invalid-path',
      'too-large',
      'unsupported',
    ])
  })
})
