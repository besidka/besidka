import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'evlog'
import type { ProjectSkillLevel } from '#shared/utils/skills-policy'
import {
  PROJECT_SKILLS_ALWAYS_MAX,
  PROJECT_SKILLS_ALWAYS_MAX_TOKENS,
  PROJECT_SKILLS_MAX,
} from '#shared/utils/skills-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import { formatSkillContent } from '~~/server/utils/skills/runtime/content'
import { loadSkillContent } from '~~/server/utils/skills/runtime/load'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export type ProjectSkillState = 'active' | 'off' | 'needs-review' | 'broken'

export interface ProjectSkillEntry {
  skillId: string
  level: ProjectSkillLevel
}

export interface ProjectSkillPin {
  skillId: string
  name: string
  description: string
  level: ProjectSkillLevel
  position: number
  state: ProjectSkillState
  tokens: number | null
}

export interface ProjectSkillsView {
  pins: ProjectSkillPin[]
  limits: {
    always: number
    total: number
    alwaysTokens: number
  }
  alwaysTokens: number
}

const PIN_COLUMNS = {
  skillId: schema.projectSkills.skillId,
  level: schema.projectSkills.level,
  position: schema.projectSkills.position,
  name: schema.skills.name,
  description: schema.skills.description,
  enabled: schema.skills.enabled,
  status: schema.skills.status,
}

export function getProjectSkillState(skill: {
  enabled: boolean
  status: string
}): ProjectSkillState {
  if (skill.status === 'broken') {
    return 'broken'
  }

  if (!skill.enabled) {
    return 'off'
  }

  return skill.status === 'ready' ? 'active' : 'needs-review'
}

function createProjectNotFoundError() {
  return createError({ message: 'Project not found', status: 404 })
}

async function requireOwnedProject(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<string> {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true },
  })

  if (!project) {
    throw createProjectNotFoundError()
  }

  return project.id
}

async function estimatePinTokens(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skillId: string
  logger: LoggerLike
}): Promise<number | null> {
  const [row] = await input.db.select({
    id: schema.skills.id,
    name: schema.skills.name,
    description: schema.skills.description,
    currentVersion: schema.skills.currentVersion,
    sourceKind: schema.skills.sourceKind,
    enabled: schema.skills.enabled,
    modelInvocable: schema.skills.modelInvocable,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, input.skillId),
      eq(schema.skills.userId, input.userId),
    ))
    .limit(1)

  if (!row) {
    return null
  }

  try {
    const loaded = await loadSkillContent({
      db: input.db,
      bucket: input.bucket,
      userId: input.userId,
      skill: row,
    })

    return estimateMemoryTokens(
      formatSkillContent({ skill: loaded, family: 'default' }).text,
      'default',
    )
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: { projectPinEstimateError: exceptionMessage(exception) },
      },
    })

    return null
  }
}

/**
 * The pins of one owned project in position order, each with the state the
 * skill is in right now (Off and broken skills stay listed, they just never
 * load) and, for an always-loaded skill that can run, its token estimate for
 * the conservative `default` family. A project the user does not own is 404.
 */
export async function listProjectSkills(
  db: DbClient,
  bucket: SkillReadBucket,
  userId: number,
  projectId: string,
  logger: LoggerLike,
): Promise<ProjectSkillsView> {
  const internalProjectId = await requireOwnedProject(db, userId, projectId)
  const rows = await db.select(PIN_COLUMNS)
    .from(schema.projectSkills)
    .innerJoin(
      schema.skills,
      eq(schema.skills.id, schema.projectSkills.skillId),
    )
    .where(and(
      eq(schema.projectSkills.projectId, internalProjectId),
      eq(schema.projectSkills.userId, userId),
      eq(schema.skills.userId, userId),
    ))
    .orderBy(asc(schema.projectSkills.position))
  const pins: ProjectSkillPin[] = []
  let alwaysTokens = 0

  for (const row of rows) {
    const state = getProjectSkillState(row)
    const tokens = row.level === 'always' && state === 'active'
      ? await estimatePinTokens({
        db,
        bucket,
        userId,
        skillId: row.skillId,
        logger,
      })
      : null

    alwaysTokens += tokens ?? 0
    pins.push({
      skillId: row.skillId,
      name: row.name,
      description: row.description,
      level: row.level,
      position: row.position,
      state,
      tokens,
    })
  }

  return {
    pins,
    limits: {
      always: PROJECT_SKILLS_ALWAYS_MAX,
      total: PROJECT_SKILLS_MAX,
      alwaysTokens: PROJECT_SKILLS_ALWAYS_MAX_TOKENS,
    },
    alwaysTokens,
  }
}

function createInvalidPinsError(why: string, fix: string) {
  return createError({
    message: 'Project skills were not saved',
    status: 400,
    why,
    fix,
  })
}

/**
 * Replaces the whole list of skills pinned to an owned project. The checks
 * are the single source of the rules, so a later MCP tool can reuse them:
 * every skill must exist and belong to the user (a foreign or unknown id
 * reads as 404 and never reveals which), no skill twice, at most
 * `PROJECT_SKILLS_MAX` pins and `PROJECT_SKILLS_ALWAYS_MAX` always-loaded,
 * a broken skill cannot be pinned, and the always-loaded skills that can run
 * must fit `PROJECT_SKILLS_ALWAYS_MAX_TOKENS`. It never changes a skill: an
 * Off skill can be pinned and stays Off, so it does not load. The position is
 * the index in `entries`. `beforeWrite` runs after every check passed and
 * right before the write, so a caller can count only calls that write. Delete
 * and inserts go in one batch.
 */
export async function setProjectSkills(
  db: DbClient,
  bucket: SkillReadBucket,
  userId: number,
  projectId: string,
  entries: readonly ProjectSkillEntry[],
  logger: LoggerLike,
  options: { beforeWrite?: () => Promise<void> } = {},
): Promise<ProjectSkillsView> {
  const internalProjectId = await requireOwnedProject(db, userId, projectId)
  const skillIds = entries.map(entry => entry.skillId)

  if (new Set(skillIds).size !== skillIds.length) {
    throw createInvalidPinsError(
      'A skill appears twice.',
      'Pin each skill once.',
    )
  }

  if (entries.length > PROJECT_SKILLS_MAX) {
    throw createInvalidPinsError(
      `A project can hold ${PROJECT_SKILLS_MAX} skills.`,
      'Remove a skill first.',
    )
  }

  const alwaysEntries = entries.filter(entry => entry.level === 'always')

  if (alwaysEntries.length > PROJECT_SKILLS_ALWAYS_MAX) {
    throw createInvalidPinsError(
      `A project can load ${PROJECT_SKILLS_ALWAYS_MAX} skills in every `
      + 'message.',
      'Move a skill to Prefer.',
    )
  }

  if (!skillIds.every(isDecodableSkillPublicId)) {
    throw createError({ message: 'Skill not found', status: 404 })
  }

  const skillRows = skillIds.length === 0
    ? []
    : await db.select({
      id: schema.skills.id,
      enabled: schema.skills.enabled,
      status: schema.skills.status,
    })
      .from(schema.skills)
      .where(and(
        eq(schema.skills.userId, userId),
        inArray(schema.skills.id, skillIds),
      ))

  if (skillRows.length !== skillIds.length) {
    throw createError({ message: 'Skill not found', status: 404 })
  }

  const statesById = new Map(skillRows.map((row) => {
    return [row.id, getProjectSkillState(row)]
  }))

  if (skillIds.some(skillId => statesById.get(skillId) === 'broken')) {
    throw createInvalidPinsError(
      'A broken skill cannot be pinned.',
      'Repair or remove the skill first.',
    )
  }

  let alwaysTokens = 0

  for (const entry of alwaysEntries) {
    if (statesById.get(entry.skillId) !== 'active') {
      continue
    }

    alwaysTokens += await estimatePinTokens({
      db,
      bucket,
      userId,
      skillId: entry.skillId,
      logger,
    }) ?? 0
  }

  if (alwaysTokens > PROJECT_SKILLS_ALWAYS_MAX_TOKENS) {
    throw createInvalidPinsError(
      'Skills loaded in every message are about '
      + `${alwaysTokens.toLocaleString('en-US')} tokens, over the limit of `
      + `${PROJECT_SKILLS_ALWAYS_MAX_TOKENS.toLocaleString('en-US')}.`,
      'Move a skill to Prefer.',
    )
  }

  await options.beforeWrite?.()

  await db.batch([
    db.delete(schema.projectSkills)
      .where(and(
        eq(schema.projectSkills.projectId, internalProjectId),
        eq(schema.projectSkills.userId, userId),
      )),
    ...entries.map((entry, position) => {
      return db.insert(schema.projectSkills).values({
        projectId: internalProjectId,
        skillId: entry.skillId,
        userId,
        level: entry.level,
        position,
      })
    }),
  ])

  return await listProjectSkills(db, bucket, userId, projectId, logger)
}

/**
 * A project is deleted: its pins go with it. The table has no foreign key,
 * so nothing cascades. Returns how many rows were removed.
 */
export async function deleteProjectSkillsForProject(
  db: DbClient,
  userId: number,
  projectId: string,
): Promise<number> {
  const rows = await db.delete(schema.projectSkills)
    .where(and(
      eq(schema.projectSkills.projectId, projectId),
      eq(schema.projectSkills.userId, userId),
    ))
    .returning({ id: schema.projectSkills.id })

  return rows.length
}
