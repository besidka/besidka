import { JEV_SKILL_SCREENING } from '#shared/utils/jev-policy'
import {
  buildSkillHighlightNotice,
  scanHighRuleRanges,
  clipNoticeRanges,
  toJevNoticeRanges,
} from '#shared/utils/skills/runtime-notice'
import type { SkillNoticeRange } from '#shared/utils/skills/runtime-notice'
import {
  readStoredSkillJevResult,
  skillJevMarksKey,
} from '~~/server/utils/skills/jev/store'
import type { SkillJevKv } from '~~/server/utils/skills/jev/store'
import { loadVersionRow } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

async function readJevRanges(input: {
  db: DbClient
  kv: SkillJevKv
  userId: number
  skillId: string
  version: number
  path: string
}): Promise<SkillNoticeRange[]> {
  try {
    return await readVerifiedJevRanges(input)
  } catch {
    return []
  }
}

async function readVerifiedJevRanges(input: {
  db: DbClient
  kv: SkillJevKv
  userId: number
  skillId: string
  version: number
  path: string
}): Promise<SkillNoticeRange[]> {
  const stored = await readStoredSkillJevResult(
    input.kv,
    skillJevMarksKey(input.userId, input.skillId, input.version),
  )

  if (
    !stored
    || stored.questionSetVersion !== JEV_SKILL_SCREENING.questionSetVersion
  ) {
    return []
  }

  const marks = stored.marks.filter(mark => mark.path === input.path)

  if (marks.length === 0) {
    return []
  }

  const row = await loadVersionRow(
    input.db,
    input.userId,
    input.skillId,
    input.version,
  )

  if (!row || row.sha256 !== stored.versionSha256) {
    return []
  }

  return toJevNoticeRanges(marks)
}

/**
 * The notice for one file of the current version of a skill, or null when
 * nothing in it was highlighted at review. It reads the stored TypeSafe AI
 * marks of the version (checked against the version's hash) and scans the
 * text with the rules, so it makes no model call and costs no spend. A
 * failure to read the marks or to scan leaves the notice out and never
 * fails the tool.
 * Line numbers are those of the file. `firstLine` and `lastLine` bound the
 * lines the reader received (the whole file for `read_skill_file`, the body
 * that survived the cut for `activate_skill`).
 */
async function computeSkillHighlightNotice(input: {
  db: DbClient
  kv?: SkillJevKv | null
  userId: number
  skillId: string
  version: number
  path: string
  fullText: string
  firstLine: number
  lastLine: number
}): Promise<string | null> {
  const ranges = [
    ...scanHighRuleRanges(input.path, input.fullText),
    ...(input.kv
      ? await readJevRanges({
        db: input.db,
        kv: input.kv,
        userId: input.userId,
        skillId: input.skillId,
        version: input.version,
        path: input.path,
      })
      : []),
  ]

  return buildSkillHighlightNotice(clipNoticeRanges({
    ranges,
    firstLine: input.firstLine,
    lastLine: input.lastLine,
  }))
}

export async function findSkillHighlightNotice(
  input: Parameters<typeof computeSkillHighlightNotice>[0],
): Promise<string | null> {
  try {
    return await computeSkillHighlightNotice(input)
  } catch {
    return null
  }
}
