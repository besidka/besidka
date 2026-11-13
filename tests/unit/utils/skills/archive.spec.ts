import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import {
  DITTO_ARCHIVE_BASE64,
  FINDER_ARCHIVE_BASE64,
  INFO_ZIP_ARCHIVE_BASE64,
  decodeBase64,
} from '../../../fixtures/skills/real-archives'
import {
  buildArchive,
  buildSymlinkArchive,
  forgeCentralSizes,
  markAsZip64,
  skillMarkdown,
  validSkillArchive,
} from '../../../setup/helpers/skill-archives'

const MEBIBYTE = 1024 * 1024

function rejectCode(bytes: Uint8Array): string {
  const result = extractSkillArchive(bytes)

  if (result.ok) {
    throw new Error('Expected the archive to be rejected')
  }

  return result.code
}

function noisyText(length: number, seed = 1): string {
  const alphabet = '0123456789abcdef'
  let state = seed
  let text = ''

  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7FFFFFFF
    text += alphabet[(state >> 16) % alphabet.length]
  }

  return text
}

describe('extractSkillArchive: accepted archives', () => {
  it('reads a skill folder with references and returns plain text', () => {
    const result = extractSkillArchive(validSkillArchive())

    expect(result).toMatchObject({ ok: true, folderName: 'review-pr' })

    if (!result.ok) {
      return
    }

    expect(result.files.map((file) => {
      return file.path
    })).toEqual(['SKILL.md', 'references/checklist.md'])
    expect(result.files[0]!.text).toContain('name: review-pr')
    expect(result.totalBytes).toBeGreaterThan(0)
  })

  it('reads SKILL.md at the archive root', () => {
    const result = extractSkillArchive(buildArchive({
      'SKILL.md': skillMarkdown(),
      'LICENSE': 'MIT text',
    }))

    expect(result).toMatchObject({ ok: true, folderName: null })
  })

  it('skips macOS noise silently and says so in a warning', () => {
    const result = extractSkillArchive(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/.DS_Store': 'binary-ish',
      'skill/._SKILL.md': 'appledouble inside the folder',
      '__MACOSX/skill/._SKILL.md': 'appledouble',
      'skill/dir/': new Uint8Array(0),
    }))

    expect(result).toMatchObject({
      ok: true,
      warnings: ['Skipped 3 macOS metadata files'],
    })

    if (result.ok) {
      expect(result.files).toHaveLength(1)
    }
  })

  it('ignores files outside the skill folder with a warning', () => {
    const result = extractSkillArchive(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'README.md': 'outside',
    }))

    expect(result).toMatchObject({
      ok: true,
      warnings: ['Ignored 1 files outside the skill folder'],
    })
  })

  it('NFC-normalises paths', () => {
    const result = extractSkillArchive(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/references/cafe\u0301.md': 'x',
    }))

    expect(result.ok && result.files.map((file) => {
      return file.path
    })).toContain('references/caf\u00E9.md')
  })

  it('accepts exactly 200 files', () => {
    const entries: Record<string, string> = { 'skill/SKILL.md': skillMarkdown() }

    for (let index = 0; index < 199; index += 1) {
      entries[`skill/references/f${index}.md`] = `file ${index}`
    }

    expect(extractSkillArchive(buildArchive(entries)).ok).toBe(true)
  })
})

describe('extractSkillArchive: path attacks', () => {
  it.each([
    '../../evil.md',
    '/etc/passwd',
    '..\\win.md',
    'skill/../../evil.md',
    'C:\\temp\\evil.md',
  ])('rejects the entry name %s', (name) => {
    const code = rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      [name]: 'evil',
    }))

    expect(['archive-unsafe-path', 'archive-path-rejected']).toContain(code)
  })

  it('rejects a bidi-override file name', () => {
    expect(rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/gnp.\u202Emd': 'x',
    }))).toBe('archive-path-rejected')
  })

  it('rejects a control character in a name', () => {
    expect(rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/a\u0007b.md': 'x',
    }))).toBe('archive-path-rejected')
  })

  it('rejects paths that are too long or too deep', () => {
    expect(rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      [`skill/${'a'.repeat(200)}.md`]: 'x',
    }))).toBe('archive-path-rejected')
    expect(rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/a/b/c/d/e/f/g.md': 'x',
    }))).toBe('archive-path-rejected')
  })

  it('rejects symbolic links', () => {
    const result = extractSkillArchive(buildSymlinkArchive())

    expect(result).toMatchObject({
      ok: false,
      code: 'archive-symlink',
      path: 'skill/link.md',
    })
  })

  it('rejects two entries that resolve to the same path', () => {
    expect(rejectCode(buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      'skill/a.md': 'x',
      'skill/./a.md': 'y',
    }))).toBe('archive-invalid')
  })
})

describe('extractSkillArchive: structure', () => {
  it('rejects a missing SKILL.md', () => {
    expect(rejectCode(buildArchive({ 'skill/readme.md': 'x' })))
      .toBe('archive-missing-skill-md')
  })

  it('rejects two top-level folders that both hold SKILL.md', () => {
    expect(rejectCode(buildArchive({
      'a/SKILL.md': skillMarkdown({ name: 'a' }),
      'b/SKILL.md': skillMarkdown({ name: 'b' }),
    }))).toBe('archive-ambiguous-root')
  })

  it('rejects something that is not a zip', () => {
    expect(rejectCode(strToU8('plain text, not a zip at all')))
      .toBe('archive-invalid')
    expect(rejectCode(new Uint8Array(0))).toBe('archive-invalid')
  })

  it('rejects zip64', () => {
    expect(rejectCode(markAsZip64(validSkillArchive()))).toBe('archive-zip64')
  })
})

describe('extractSkillArchive: content rules', () => {
  it('rejects .pyc and other compiled files', () => {
    expect(rejectCode(validSkillArchive({ 'scripts/x.pyc': 'bytes' })))
      .toBe('archive-path-rejected')
    expect(rejectCode(validSkillArchive({ 'lib/tool.so': 'bytes' })))
      .toBe('archive-path-rejected')
  })

  it('rejects a binary with no allowed extension and an ELF named .md', () => {
    const elf = new Uint8Array([
      0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00,
    ])

    expect(rejectCode(validSkillArchive({ 'bin/tool': elf })))
      .toBe('archive-path-rejected')
    expect(rejectCode(validSkillArchive({ 'notes.md': elf })))
      .toBe('archive-binary-content')
  })

  it('rejects invalid UTF-8', () => {
    expect(rejectCode(validSkillArchive({
      'notes.md': new Uint8Array([0x61, 0xFF, 0xFE, 0x62]),
    }))).toBe('archive-not-utf8')
  })

  it('rejects a SKILL.md over 256 KiB', () => {
    expect(rejectCode(validSkillArchive(
      {},
      skillMarkdown({ body: noisyText(300 * 1024) }),
    ))).toBe('archive-skill-md-too-large')
  })

  it('rejects a file over 1 MiB', () => {
    expect(rejectCode(validSkillArchive({
      'references/big.md': noisyText(MEBIBYTE + 10),
    }))).toBe('archive-entry-too-large')
  })

  it('rejects more than 200 files', () => {
    const entries: Record<string, string> = { 'skill/SKILL.md': skillMarkdown() }

    for (let index = 0; index < 200; index += 1) {
      entries[`skill/references/f${index}.md`] = `file ${index}`
    }

    expect(rejectCode(buildArchive(entries))).toBe('archive-too-many-files')
  })

  it('rejects more than 5 MiB uncompressed', () => {
    const entries: Record<string, string> = { 'skill/SKILL.md': skillMarkdown() }

    for (let index = 0; index < 6; index += 1) {
      entries[`skill/references/part${index}.md`] = noisyText(
        MEBIBYTE - 100,
        index + 1,
      )
    }

    expect(['archive-total-too-large']).toContain(
      rejectCode(buildArchive(entries)),
    )
  })

  it('rejects a compressed archive over 5 MiB', () => {
    expect(rejectCode(new Uint8Array(5 * MEBIBYTE + 1)))
      .toBe('archive-too-large')
  })
})

describe('extractSkillArchive: zip bombs', () => {
  it('rejects an entry that expands more than 100:1', () => {
    expect(rejectCode(validSkillArchive({
      'references/zeros.md': 'a'.repeat(MEBIBYTE),
    }))).toBe('archive-ratio')
  })

  it('rejects an entry declared as 1 GB', () => {
    const forged = forgeCentralSizes(
      validSkillArchive(),
      'review-pr/references/checklist.md',
      { uncompressed: 1_000_000_000 },
    )

    expect(rejectCode(forged)).toBe('archive-entry-too-large')
  })

  it('rejects an entry that inflates past its forged declared size', () => {
    const forged = forgeCentralSizes(
      validSkillArchive({ 'references/real.md': noisyText(50_000) }),
      'review-pr/references/real.md',
      { uncompressed: 100 },
    )

    expect(rejectCode(forged)).toBe('archive-corrupt')
  })

  it('rejects an entry that inflates to less than declared', () => {
    const forged = forgeCentralSizes(
      validSkillArchive({ 'references/real.md': noisyText(5_000) }),
      'review-pr/references/real.md',
      { uncompressed: 6_000 },
    )

    expect(rejectCode(forged)).toBe('archive-corrupt')
  })
})

describe('extractSkillArchive: archives made by real tools', () => {
  it.each([
    ['Finder (ditto --sequesterRsrc)', FINDER_ARCHIVE_BASE64],
    ['ditto with embedded AppleDouble files', DITTO_ARCHIVE_BASE64],
    ['Info-ZIP zip -r', INFO_ZIP_ARCHIVE_BASE64],
  ])('accepts a skill folder zipped by %s', (_name, base64) => {
    const result = extractSkillArchive(decodeBase64(base64))

    expect(result).toMatchObject({ ok: true, folderName: 'review-pr' })

    if (result.ok) {
      expect(result.files.map((file) => {
        return file.path
      })).toEqual(['SKILL.md', 'references/checklist.md'])
      expect(result.warnings.join(' ')).toContain('macOS metadata')
    }
  })
})
