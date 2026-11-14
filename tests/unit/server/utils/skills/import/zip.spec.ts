import { describe, expect, it } from 'vitest'
import {
  createSkillSourceVersion,
  readSkillArchive,
} from '~~/server/utils/skills/import/zip'
import {
  buildArchive,
  buildSymlinkArchive,
  forgeCentralSizes,
  markAsZip64,
  skillMarkdown,
  validSkillArchive,
} from '../../../../../setup/helpers/skill-archives'

function thrownStatus(bytes: Uint8Array): { status: number, code?: string } {
  try {
    readSkillArchive(bytes)
  } catch (exception) {
    const error = exception as { status: number, code?: string }

    return { status: error.status, code: error.code }
  }

  throw new Error('Expected the archive to be rejected')
}

describe('readSkillArchive', () => {
  it('returns the extracted files of a valid archive', () => {
    const result = readSkillArchive(validSkillArchive())

    expect(result.folderName).toBe('review-pr')
    expect(result.files.map((file) => {
      return file.path
    })).toEqual(['SKILL.md', 'references/checklist.md'])
  })

  it('rejects a crafted archive even when the client check was bypassed', () => {
    const crafted = [
      buildArchive({
        'skill/SKILL.md': skillMarkdown(),
        '../../evil.md': 'x',
      }),
      buildSymlinkArchive(),
      markAsZip64(validSkillArchive()),
      forgeCentralSizes(
        validSkillArchive(),
        'review-pr/references/checklist.md',
        { uncompressed: 1_000_000_000 },
      ),
    ]

    for (const bytes of crafted) {
      expect(thrownStatus(bytes).status).toBeGreaterThanOrEqual(400)
    }
  })

  it('answers 413 for sizes and 400 for structure', () => {
    expect(thrownStatus(new Uint8Array(5 * 1024 * 1024 + 1))).toEqual({
      status: 413,
      code: 'archive-too-large',
    })
    expect(thrownStatus(buildSymlinkArchive())).toEqual({
      status: 400,
      code: 'archive-symlink',
    })
    expect(thrownStatus(buildArchive({ 'skill/readme.md': 'x' }))).toEqual({
      status: 400,
      code: 'archive-missing-skill-md',
    })
  })
})

describe('createSkillSourceVersion', () => {
  it('is sha256- plus the first 16 hex of the content', async () => {
    const version = await createSkillSourceVersion('hello')

    expect(version).toBe('sha256-2cf24dba5fb0a30e')
  })
})
