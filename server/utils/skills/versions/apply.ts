import { sha256Hex } from '#shared/utils/knowledge-hash'
import {
  SKILL_EDIT_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_SKILL_MD_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_SAVE_MAX_BYTES,
} from '#shared/utils/skills-policy'
import type { SkillFileKind } from '#shared/utils/skills-policy'
import {
  isSkillLicenceRootFile,
  validateSkillEditPath,
} from '#shared/utils/skills/edit'
import type { SkillChange } from '#shared/utils/skills/edit'
import {
  SKILL_MD_FILE_NAME,
  getSkillFileKind,
} from '#shared/utils/skills/path'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'

const textEncoder = new TextEncoder()

export interface WorkingSkillFile {
  path: string
  blobSha256: string
  bytes: number
  kind: SkillFileKind
}

export interface PutContent {
  bytes: Uint8Array
  text: string
}

export interface AppliedChanges {
  files: WorkingSkillFile[]
  puts: Map<string, PutContent>
  putBytes: number
}

function invalidPath(index: number, reason: string) {
  return createSkillEditError('invalid-path', {
    message: 'This file name cannot be used',
    why: reason,
    fix: 'Use a plain relative path of text files, such as references/guide.md',
    data: { changeIndex: index },
  })
}

function assertPathAllowed(index: number, path: string): void {
  const reason = validateSkillEditPath(path)

  if (reason) {
    throw invalidPath(index, reason)
  }
}

function assertLicenceUnlocked(
  index: number,
  path: string,
  locksLicenceFiles: boolean,
): void {
  if (locksLicenceFiles && isSkillLicenceRootFile(path)) {
    throw createSkillEditError('licence-file-locked', {
      message: 'Licence files cannot be changed in this skill',
      why: 'The skill has an open or custom licence, which has to stay as it was published',
      fix: 'Leave the LICENSE and NOTICE files as they are',
      data: { changeIndex: index },
    })
  }
}

function assertNotSkillMd(index: number, path: string): void {
  if (path === SKILL_MD_FILE_NAME) {
    throw createSkillEditError('skill-md-required', {
      message: 'SKILL.md cannot be deleted or renamed',
      why: 'Every skill needs its SKILL.md at the root',
      fix: 'Edit the content of SKILL.md instead',
      data: { changeIndex: index },
    })
  }
}

function findCaseVariant(
  files: Map<string, WorkingSkillFile>,
  path: string,
): string | null {
  const lowerCased = path.toLowerCase()

  for (const existing of files.keys()) {
    if (existing !== path && existing.toLowerCase() === lowerCased) {
      return existing
    }
  }

  return null
}

function assertPathFree(
  index: number,
  files: Map<string, WorkingSkillFile>,
  path: string,
): void {
  if (files.has(path) || findCaseVariant(files, path) !== null) {
    throw createSkillEditError('path-exists', {
      message: 'A file with this name exists',
      why: 'File names are compared without regard to upper and lower case',
      fix: 'Choose another name',
      data: { changeIndex: index },
    })
  }
}

function toPutContent(index: number, content: string): PutContent {
  if (content.includes('\u0000')) {
    throw createSkillEditError('binary-content', {
      message: 'This file contains binary data',
      why: 'Skills hold text only',
      fix: 'Remove the binary data',
      data: { changeIndex: index },
    })
  }

  const bytes = textEncoder.encode(content)

  if (bytes.byteLength > SKILL_EDIT_MAX_FILE_BYTES) {
    throw createSkillEditError('file-too-large', {
      message: 'This file is too large to save from the editor',
      why: `A file saved in the app can hold at most ${
        SKILL_EDIT_MAX_FILE_BYTES / 1024
      } KiB`,
      fix: 'Split the file into smaller files',
      data: { changeIndex: index },
    })
  }

  return { bytes, text: content }
}

/**
 * Applies the changes of one save, in order, to the file set of the base
 * version. Paths go through the import path rules, SKILL.md stays, licence
 * files stay while the licence is open or custom, and the per-save caps hold.
 * Nothing is written here. Only the changed contents are held in memory.
 */
export async function applySkillChanges(input: {
  baseFiles: WorkingSkillFile[]
  changes: SkillChange[]
  locksLicenceFiles: boolean
}): Promise<AppliedChanges> {
  const files = new Map<string, WorkingSkillFile>(
    input.baseFiles.map((file) => {
      return [file.path, file]
    }),
  )
  const puts = new Map<string, PutContent>()
  let putBytes = 0

  for (const [index, change] of input.changes.entries()) {
    if (change.op === 'put') {
      assertPathAllowed(index, change.path)
      assertLicenceUnlocked(index, change.path, input.locksLicenceFiles)

      const content = toPutContent(index, change.content)
      const isNew = !files.has(change.path)

      if (isNew) {
        assertPathFree(index, files, change.path)
      }

      putBytes += content.bytes.byteLength

      if (putBytes > SKILL_SAVE_MAX_BYTES) {
        throw createSkillEditError('save-too-large', {
          message: 'This save is too large',
          why: `One save can carry at most ${
            SKILL_SAVE_MAX_BYTES / 1024 / 1024
          } MiB of file content`,
          fix: 'Save fewer files at a time',
          data: { changeIndex: index },
        })
      }

      const blobSha256 = await sha256Hex(content.bytes as BufferSource)

      puts.set(blobSha256, content)
      files.set(change.path, {
        path: change.path,
        blobSha256,
        bytes: content.bytes.byteLength,
        kind: getSkillFileKind(change.path),
      })

      continue
    }

    if (change.op === 'delete') {
      assertNotSkillMd(index, change.path)
      assertLicenceUnlocked(index, change.path, input.locksLicenceFiles)

      if (!files.delete(change.path)) {
        throw createSkillEditError('path-missing', {
          message: 'This file does not exist',
          why: 'A change deletes a file the skill does not have',
          fix: 'Reload the skill and try again',
          data: { changeIndex: index },
        })
      }

      continue
    }

    assertNotSkillMd(index, change.from)
    assertNotSkillMd(index, change.to)
    assertLicenceUnlocked(index, change.from, input.locksLicenceFiles)
    assertLicenceUnlocked(index, change.to, input.locksLicenceFiles)
    assertPathAllowed(index, change.to)

    const source = files.get(change.from)

    if (!source) {
      throw createSkillEditError('path-missing', {
        message: 'This file does not exist',
        why: 'A change renames a file the skill does not have',
        fix: 'Reload the skill and try again',
        data: { changeIndex: index },
      })
    }

    files.delete(change.from)
    assertPathFree(index, files, change.to)
    files.set(change.to, {
      ...source,
      path: change.to,
      kind: getSkillFileKind(change.to),
    })
  }

  const resultFiles = [...files.values()].sort((left, right) => {
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  })

  assertWithinSkillLimits(resultFiles)

  return { files: resultFiles, puts, putBytes }
}

export function assertWithinSkillLimits(files: WorkingSkillFile[]): void {
  if (files.length > SKILL_MAX_FILES) {
    throw createSkillEditError('too-many-files', {
      message: 'This skill has too many files',
      why: `A skill can hold at most ${SKILL_MAX_FILES} files`,
      fix: 'Delete a file you do not need',
    })
  }

  const skillMd = files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })

  if (!skillMd) {
    throw createSkillEditError('skill-md-required', {
      message: 'A skill needs a SKILL.md',
      why: 'The version has no SKILL.md at its root',
      fix: 'Add a SKILL.md with a name and a description',
    })
  }

  if (skillMd.bytes > SKILL_MAX_SKILL_MD_BYTES) {
    throw createSkillEditError('file-too-large', {
      message: 'SKILL.md is over 256 KiB',
      why: 'SKILL.md is capped at 256 KiB',
      fix: 'Move long material into a file under references/',
    })
  }

  const totalBytes = files.reduce((total, file) => {
    return total + file.bytes
  }, 0)

  if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
    throw createSkillEditError('skill-too-large', {
      message: 'This skill is too large',
      why: `A skill can hold at most ${
        SKILL_MAX_TOTAL_BYTES / 1024 / 1024
      } MiB of files`,
      fix: 'Delete or shorten a file',
    })
  }
}
