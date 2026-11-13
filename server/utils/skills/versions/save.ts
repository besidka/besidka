import type { SkillChange } from '#shared/utils/skills/edit'
import { scanSkillTextWithCounts } from '#shared/utils/skills/findings'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { applySkillChanges } from '~~/server/utils/skills/versions/apply'
import type { WorkingSkillFile } from '~~/server/utils/skills/versions/apply'
import { createStaleBaseError } from '~~/server/utils/skills/versions/errors'
import { prepareSkillVersion } from '~~/server/utils/skills/versions/prepare'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readBlobText,
} from '~~/server/utils/skills/versions/read'
import { writeSkillVersion } from '~~/server/utils/skills/versions/write'
import type {
  SkillWriteBucket,
  WrittenSkillVersion,
} from '~~/server/utils/skills/versions/write'

type DbClient = ReturnType<typeof useDb>

export interface SaveSkillInput {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  skillId: string
  baseVersion: number
  changes: SkillChange[]
  note: string | null
  logger: LoggerLike
}

export type SaveSkillResult
  = | ({ unchanged: false, id: string } & WrittenSkillVersion)
    | { unchanged: true, id: string, version: number }

function countOccurrences(shas: string[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const sha of shas) {
    counts.set(sha, (counts.get(sha) ?? 0) + 1)
  }

  return counts
}

function addCounts(
  target: Record<string, number>,
  counts: Record<string, number>,
  sign: 1 | -1,
): void {
  for (const [type, count] of Object.entries(counts)) {
    target[type] = Math.max(0, (target[type] ?? 0) + sign * count)
  }
}

/**
 * Finding counts of the new version without reading the whole skill: the
 * counts of the base version, plus those of the contents that appeared and
 * minus those of the contents that went away. Contents are compared as a
 * multiset of blobs, so a rename changes nothing and a file copied to a
 * second path counts twice, as a full scan would. Only the removed blobs
 * are read from R2, at most one per changed file; a blob that is already
 * missing is skipped, so a save can still repair a broken skill.
 */
async function computeFindingCounts(input: {
  bucket: SkillWriteBucket
  userId: number
  skillId: string
  baseCounts: Record<string, number> | null
  baseFiles: WorkingSkillFile[]
  nextFiles: WorkingSkillFile[]
  heldTexts: Map<string, string>
}): Promise<Record<string, number>> {
  const baseOccurrences = countOccurrences(input.baseFiles.map((file) => {
    return file.blobSha256
  }))
  const nextOccurrences = countOccurrences(input.nextFiles.map((file) => {
    return file.blobSha256
  }))
  const counts: Record<string, number> = { ...input.baseCounts }

  for (const [sha, nextCount] of nextOccurrences) {
    const appeared = nextCount - (baseOccurrences.get(sha) ?? 0)
    const text = input.heldTexts.get(sha)

    if (appeared > 0 && text !== undefined) {
      for (let copy = 0; copy < appeared; copy++) {
        addCounts(counts, scanSkillTextWithCounts('', text).counts, 1)
      }
    }
  }

  for (const [sha, baseCount] of baseOccurrences) {
    const removed = baseCount - (nextOccurrences.get(sha) ?? 0)

    if (removed <= 0) {
      continue
    }

    let text: string

    try {
      text = await readBlobText({
        bucket: input.bucket,
        userId: input.userId,
        skillId: input.skillId,
        blobSha256: sha,
      })
    } catch {
      continue
    }

    for (let copy = 0; copy < removed; copy++) {
      addCounts(counts, scanSkillTextWithCounts('', text).counts, -1)
    }
  }

  return Object.fromEntries(Object.entries(counts).filter(([, count]) => {
    return count > 0
  }))
}

/**
 * Applies the changes of one save to the base version and writes the result
 * as the next version (docs/skills.md section 8.7). A save with no effect
 * returns the current version and writes nothing.
 */
export async function saveSkillChanges(
  input: SaveSkillInput,
): Promise<SaveSkillResult> {
  const { db, bucket, userId, skillId } = input
  const skill = await loadOwnedSkill(db, userId, skillId)

  if (skill.currentVersion !== input.baseVersion) {
    throw createStaleBaseError()
  }

  const baseRows = await loadVersionFiles(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )
  const baseFiles: WorkingSkillFile[] = baseRows.map((row) => {
    return {
      path: row.path,
      blobSha256: row.blobSha256,
      bytes: row.bytes,
      kind: row.kind,
    }
  })
  const applied = await applySkillChanges({
    baseFiles,
    changes: input.changes,
    locksLicenceFiles: skill.licenseClass === 'open'
      || skill.licenseClass === 'custom',
  })
  const heldTexts = new Map<string, string>()

  for (const [sha, content] of applied.puts) {
    heldTexts.set(sha, content.text)
  }

  const prepared = await prepareSkillVersion({
    db,
    bucket,
    userId,
    skill,
    files: applied.files,
    heldTexts,
  })
  const baseRow = await loadVersionRow(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )

  if (baseRow && baseRow.sha256 === prepared.sha256) {
    return { unchanged: true, id: skillId, version: skill.currentVersion }
  }

  const findingCounts = await computeFindingCounts({
    bucket,
    userId,
    skillId,
    baseCounts: baseRow?.findings ?? null,
    baseFiles,
    nextFiles: applied.files,
    heldTexts,
  })
  const written = await writeSkillVersion({
    db,
    bucket,
    userId,
    skill,
    baseVersion: input.baseVersion,
    files: applied.files,
    prepared,
    blobsToWrite: new Map([...applied.puts].map(([sha, content]) => {
      return [sha, content.bytes]
    })),
    origin: prepared.renamed ? 'rename' : 'editor',
    note: input.note,
    findingCounts,
    logger: input.logger,
  })

  input.logger.set({
    attributes: {
      skills: {
        save: {
          changes: input.changes.length,
          puts: input.changes.filter((change) => {
            return change.op === 'put'
          }).length,
          deletes: input.changes.filter((change) => {
            return change.op === 'delete'
          }).length,
          renames: input.changes.filter((change) => {
            return change.op === 'rename'
          }).length,
          version: written.version,
          renamed: written.renamed,
          files: written.filesCount,
          bytes: written.bytes,
          licenceClass: written.licenseClass,
          findings: written.findingCounts,
        },
      },
    },
  })

  return { unchanged: false, id: skillId, ...written }
}
