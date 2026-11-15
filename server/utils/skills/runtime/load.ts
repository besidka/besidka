import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
import type { ProjectSkillLevel } from '#shared/utils/skills-policy'
import { splitSkillFrontmatter } from '#shared/utils/skills/frontmatter'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import * as schema from '~~/server/db/schema'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import {
  loadVersionFiles,
  readBlobText,
} from '~~/server/utils/skills/versions/read'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export interface RuntimeSkillRow {
  id: string
  name: string
  description: string
  currentVersion: number
  sourceKind: string
  enabled: boolean
  modelInvocable: boolean
}

export interface ProjectRuntimeSkillRow extends RuntimeSkillRow {
  level: ProjectSkillLevel
  position: number
}

export interface RuntimeSkillFile {
  path: string
  bytes: number
  kind: string
}

export interface LoadedSkillContent extends RuntimeSkillRow {
  body: string
  files: RuntimeSkillFile[]
}

const RUNTIME_SKILL_COLUMNS = {
  id: schema.skills.id,
  name: schema.skills.name,
  description: schema.skills.description,
  currentVersion: schema.skills.currentVersion,
  sourceKind: schema.skills.sourceKind,
  enabled: schema.skills.enabled,
  modelInvocable: schema.skills.modelInvocable,
}

/**
 * The skills the model may activate on its own: the user's enabled,
 * model-invocable skills that are not broken, sorted by name.
 */
export async function listCatalogSkills(
  db: DbClient,
  userId: number,
): Promise<RuntimeSkillRow[]> {
  return await db.select(RUNTIME_SKILL_COLUMNS)
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, userId),
      eq(schema.skills.enabled, true),
      eq(schema.skills.modelInvocable, true),
      ne(schema.skills.status, 'broken'),
    ))
    .orderBy(asc(schema.skills.name))
}

/**
 * The skills pinned to a project that can run right now: enabled and
 * `ready` (a skill that is Off, awaiting review or broken is skipped without
 * a word), in the order the user set. The pin overrides the invocation mode,
 * so a skill set to Only when I ask is returned too.
 */
export async function listProjectRuntimeSkills(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<ProjectRuntimeSkillRow[]> {
  return await db.select({
    ...RUNTIME_SKILL_COLUMNS,
    level: schema.projectSkills.level,
    position: schema.projectSkills.position,
  })
    .from(schema.projectSkills)
    .innerJoin(
      schema.skills,
      eq(schema.skills.id, schema.projectSkills.skillId),
    )
    .where(and(
      eq(schema.projectSkills.projectId, projectId),
      eq(schema.projectSkills.userId, userId),
      eq(schema.skills.userId, userId),
      eq(schema.skills.enabled, true),
      eq(schema.skills.status, 'ready'),
    ))
    .orderBy(asc(schema.projectSkills.position))
}

/**
 * One skill the user owns that can run right now: enabled and not broken.
 * Anything else, including an id that does not decode, is `null`, so callers
 * can answer every failure the same way.
 */
export async function findRunnableSkill(
  db: DbClient,
  userId: number,
  skillId: string,
): Promise<RuntimeSkillRow | null> {
  if (!isDecodableSkillPublicId(skillId)) {
    return null
  }

  const [row] = await db.select(RUNTIME_SKILL_COLUMNS)
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, skillId),
      eq(schema.skills.userId, userId),
      eq(schema.skills.enabled, true),
      ne(schema.skills.status, 'broken'),
    ))
    .limit(1)

  return row ?? null
}

/**
 * The skills a chat may keep re-injecting: the same rows as
 * `findRunnableSkill`, and also model-invocable. A skill switched to Only
 * when I ask runs once per explicit invocation, so an earlier activation of
 * it does not carry over, unless the project pins it (`pinnedSkillIds`).
 */
export async function findRunnableSkills(
  db: DbClient,
  userId: number,
  skillIds: readonly string[],
  pinnedSkillIds: ReadonlySet<string> = new Set(),
): Promise<RuntimeSkillRow[]> {
  const decodable = skillIds.filter(isDecodableSkillPublicId)

  if (decodable.length === 0) {
    return []
  }

  return await db.select(RUNTIME_SKILL_COLUMNS)
    .from(schema.skills)
    .where(and(
      inArray(schema.skills.id, decodable),
      eq(schema.skills.userId, userId),
      eq(schema.skills.enabled, true),
      pinnedSkillIds.size > 0
        ? or(
          eq(schema.skills.modelInvocable, true),
          inArray(schema.skills.id, [...pinnedSkillIds]),
        )
        : eq(schema.skills.modelInvocable, true),
      ne(schema.skills.status, 'broken'),
    ))
}

/**
 * The current version of a skill: `SKILL.md` without its frontmatter plus the
 * file list. The blob is read from R2 only after the row was found for this
 * user in D1. A missing blob throws.
 */
export async function loadSkillContent(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skill: RuntimeSkillRow
}): Promise<LoadedSkillContent> {
  const { db, bucket, userId, skill } = input
  const files = await loadVersionFiles(
    db,
    userId,
    skill.id,
    skill.currentVersion,
  )
  const skillMd = files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })

  if (!skillMd) {
    throw new Error('SKILL.md is missing')
  }

  const text = await readBlobText({
    bucket,
    userId,
    skillId: skill.id,
    blobSha256: skillMd.blobSha256,
  })
  const split = splitSkillFrontmatter(text)

  return {
    ...skill,
    body: split.ok ? split.body.replace(/^\n+/, '') : text,
    files: files.map((file) => {
      return { path: file.path, bytes: file.bytes, kind: file.kind }
    }),
  }
}

export async function readSkillFileText(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skill: RuntimeSkillRow
  path: string
}): Promise<{ text: string, bytes: number } | null> {
  const files = await loadVersionFiles(
    input.db,
    input.userId,
    input.skill.id,
    input.skill.currentVersion,
  )
  const file = files.find((candidate) => {
    return candidate.path === input.path
  })

  if (!file) {
    return null
  }

  return {
    bytes: file.bytes,
    text: await readBlobText({
      bucket: input.bucket,
      userId: input.userId,
      skillId: input.skill.id,
      blobSha256: file.blobSha256,
    }),
  }
}
