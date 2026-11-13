import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractGithubSkillArchive } from '#shared/utils/skills/github-archive'
import type { GithubArchiveResult } from '#shared/utils/skills/github-archive'
import {
  buildArchive,
  skillMarkdown,
} from '../../../setup/helpers/skill-archives'
import type { ArchiveEntry } from '../../../setup/helpers/skill-archives'

const TOP = 'repo-0123456789abcdef0123456789abcdef01234567'
const SYMLINK_MODE = 0o120777

function repoArchive(entries: Record<string, ArchiveEntry>): Uint8Array {
  return buildArchive(Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => {
      return [`${TOP}/${name}`, entry]
    }),
  ))
}

function skillOf(result: GithubArchiveResult) {
  if (!result.ok || result.kind !== 'skill') {
    throw new Error(`Expected a skill, got ${JSON.stringify(result)}`)
  }

  return result
}

function failureOf(result: GithubArchiveResult) {
  if (result.ok) {
    throw new Error('Expected a failure')
  }

  return result
}

describe('extractGithubSkillArchive', () => {
  it('reads the skill at the requested folder and nothing else', () => {
    const bytes = repoArchive({
      'README.md': '# Repo\n',
      'skills/review/SKILL.md': skillMarkdown(),
      'skills/review/references/a.md': 'a\n',
      'skills/other/SKILL.md': skillMarkdown({ name: 'other' }),
      'app/logo.png': new Uint8Array([137, 80, 78, 71, 0, 1]),
    })
    const result = skillOf(
      extractGithubSkillArchive(bytes, { path: 'skills/review' }),
    )

    expect(result.files.map((file) => {
      return file.path
    })).toEqual(['SKILL.md', 'references/a.md'])
    expect(result.skillPath).toBe('skills/review')
    expect(result.folderName).toBe('review')
  })

  it('is not failed by a hostile entry outside the requested folder', () => {
    const bytes = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'assets/video.mp4': new Uint8Array(2048).fill(7),
      'weird:name.txt': 'x',
      'link': [strToU8('/etc/passwd'), { os: 3, attrs: SYMLINK_MODE * 0x10000 }],
    })

    expect(skillOf(extractGithubSkillArchive(
      bytes,
      { path: 'skills/review' },
    )).files).toHaveLength(1)
  })

  it('rejects a symlink and a binary file inside the skill folder', () => {
    const symlink = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'skills/review/link.md': [
        strToU8('/etc/passwd'),
        { os: 3, attrs: SYMLINK_MODE * 0x10000 },
      ],
    })
    const binary = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'skills/review/logo.png': new Uint8Array([1, 2, 3]),
    })

    expect(failureOf(extractGithubSkillArchive(
      symlink,
      { path: 'skills/review' },
    )).code).toBe('archive-symlink')
    expect(failureOf(extractGithubSkillArchive(
      binary,
      { path: 'skills/review' },
    )).code).toBe('archive-path-rejected')
  })

  it('does not let a symlink elsewhere fail a repo-level link', () => {
    const bytes = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'docs/link.md': [
        strToU8('/etc/passwd'),
        { os: 3, attrs: SYMLINK_MODE * 0x10000 },
      ],
    })

    expect(skillOf(extractGithubSkillArchive(bytes, { path: null })).skillPath)
      .toBe('skills/review')
  })

  it('takes the skill at the repository root', () => {
    const bytes = repoArchive({
      'SKILL.md': skillMarkdown(),
      'references/a.md': 'a\n',
    })
    const result = skillOf(extractGithubSkillArchive(bytes, { path: null }))

    expect(result.skillPath).toBeNull()
    expect(result.folderName).toBeNull()
    expect(result.files).toHaveLength(2)
  })

  it('finds a single skill below a folder without a SKILL.md', () => {
    const bytes = repoArchive({
      'plugins/x/skills/review/SKILL.md': skillMarkdown(),
      'plugins/x/README.md': '# x\n',
    })
    const result = skillOf(extractGithubSkillArchive(bytes, { path: null }))

    expect(result.skillPath).toBe('plugins/x/skills/review')
  })

  it('answers a pick list when several skills are found', () => {
    const bytes = repoArchive({
      'skills/b/SKILL.md': skillMarkdown({ name: 'b' }),
      'skills/a/SKILL.md': skillMarkdown({ name: 'a' }),
      'skills/a/examples/inner/SKILL.md': skillMarkdown({ name: 'inner' }),
    })

    expect(extractGithubSkillArchive(bytes, { path: 'skills' })).toEqual({
      ok: true,
      kind: 'pick',
      candidates: ['skills/a', 'skills/b'],
      total: 2,
    })
  })

  it('caps the pick list at ten and reports the total', () => {
    const entries: Record<string, ArchiveEntry> = {}

    for (let index = 0; index < 13; index++) {
      const name = `skill-${String(index).padStart(2, '0')}`

      entries[`skills/${name}/SKILL.md`] = skillMarkdown({ name })
    }

    const result = extractGithubSkillArchive(
      repoArchive(entries),
      { path: null },
    )

    expect(result).toMatchObject({ kind: 'pick', total: 13 })
    expect((result as { candidates: string[] }).candidates).toHaveLength(10)
  })

  it('reports a missing folder and a repository with no skill', () => {
    const bytes = repoArchive({ 'README.md': '# x\n', 'src/a.md': 'a\n' })

    expect(failureOf(extractGithubSkillArchive(bytes, { path: 'nope' })).code)
      .toBe('archive-missing-skill-md')
    expect(failureOf(extractGithubSkillArchive(bytes, { path: null })).code)
      .toBe('archive-missing-skill-md')
  })

  it('returns the repository-root licence files for a subfolder skill', () => {
    const bytes = repoArchive({
      'LICENSE': 'MIT License\n',
      'NOTICE': 'notice\n',
      'skills/review/SKILL.md': skillMarkdown(),
      'docs/LICENSE.md': 'not root\n',
    })
    const result = skillOf(
      extractGithubSkillArchive(bytes, { path: 'skills/review' }),
    )

    expect(result.licenceFiles.map((file) => {
      return file.path
    })).toEqual(['LICENSE', 'NOTICE'])
    expect(result.files.map((file) => {
      return file.path
    })).toEqual(['SKILL.md'])
  })

  it('finds the root licence when the link is the repository root', () => {
    const bytes = repoArchive({
      'LICENSE': 'MIT License\n',
      'skills/review/SKILL.md': skillMarkdown(),
    })
    const result = skillOf(extractGithubSkillArchive(bytes, { path: null }))

    expect(result.licenceFiles.map((file) => {
      return file.path
    })).toEqual(['LICENSE'])
  })

  it('applies the skill rules to the inflated files', () => {
    const tooBig = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'skills/review/big.md': 'x'.repeat(1024 * 1024 + 1),
    })
    const notUtf8 = repoArchive({
      'skills/review/SKILL.md': skillMarkdown(),
      'skills/review/bad.md': new Uint8Array([0xFF, 0xFE, 0xFD]),
    })

    expect(failureOf(extractGithubSkillArchive(
      tooBig,
      { path: 'skills/review' },
    )).code).toMatch(/archive-(entry-too-large|ratio)/)
    expect(failureOf(extractGithubSkillArchive(
      notUtf8,
      { path: 'skills/review' },
    )).code).toBe('archive-not-utf8')
  })

  it('refuses an archive without a single top-level folder', () => {
    const bytes = buildArchive({
      'a/SKILL.md': skillMarkdown(),
      'b/README.md': 'x\n',
    })

    expect(failureOf(extractGithubSkillArchive(bytes, { path: null })).code)
      .toBe('archive-invalid')
  })

  it('refuses something that is not a zip, and an oversize archive', () => {
    expect(failureOf(extractGithubSkillArchive(
      strToU8('not a zip at all'),
      { path: null },
    )).code).toBe('archive-invalid')
    expect(failureOf(extractGithubSkillArchive(
      new Uint8Array(25 * 1024 * 1024 + 1),
      { path: null },
    )).code).toBe('archive-too-large')
  })
})
