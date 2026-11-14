import { and, eq, ne } from 'drizzle-orm'
import {
  normalizeSkillCommand,
  validateSkillSlashName,
} from '#shared/utils/skills-policy'
import { getSkillModeColumns } from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { findUniqueViolation } from '~~/server/utils/skills/unique-violation'
import {
  createSkillCommandTakenError,
  createSkillEditError,
} from '~~/server/utils/skills/versions/errors'
import { loadOwnedSkill } from '~~/server/utils/skills/versions/read'
import { toSkillSummary } from '~~/server/utils/skills/versions/view'

type DbClient = ReturnType<typeof useDb>

export interface SkillSettingsChanges {
  mode?: SkillMode
  command?: string | null
  argumentHint?: string | null
}

/**
 * Validates a command for the one user: the shared pattern, not reserved by
 * Besidka, and not another skill's command. Returns the value to store.
 */
export async function resolveSkillCommand(input: {
  db: DbClient
  userId: number
  command: string | null | undefined
  exceptSkillId?: string
}): Promise<string | null> {
  const command = normalizeSkillCommand(input.command)

  if (command === null) {
    return null
  }

  const validation = validateSkillSlashName(command)

  if (!validation.valid) {
    throw createSkillEditError('reserved-name', {
      message: validation.message,
      why: validation.reason === 'reserved'
        ? 'This command belongs to a built-in Besidka command'
        : 'A command cannot be typed with these characters',
      fix: 'Pick another command',
    })
  }

  const [taken] = await input.db.select({ id: schema.skills.id })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, input.userId),
      eq(schema.skills.slashName, command),
      input.exceptSkillId
        ? ne(schema.skills.id, input.exceptSkillId)
        : undefined,
    ))
    .limit(1)

  if (taken) {
    throw createSkillCommandTakenError(command)
  }

  return command
}

/**
 * Settings are not content: no version is created. `mode` sets `enabled` and
 * `modelInvocable` together in one statement and `command` is independent of
 * it: a reserved or invalid command is refused with a 400, a command another
 * skill already uses with a 409. A skill with missing files cannot be
 * enabled.
 */
export async function updateSkillSettings(input: {
  db: DbClient
  userId: number
  skillId: string
  changes: SkillSettingsChanges
  logger: LoggerLike
}) {
  const { db, userId } = input
  const { mode, command, argumentHint } = input.changes
  const skill = await loadOwnedSkill(db, userId, input.skillId)
  const changes: Partial<typeof schema.skills.$inferInsert> = {
    ...(mode ? getSkillModeColumns(mode) : {}),
    ...(argumentHint === undefined ? {} : { argumentHint }),
  }

  if (command !== undefined) {
    changes.slashName = await resolveSkillCommand({
      db,
      userId,
      command,
      exceptSkillId: skill.id,
    })
  }

  if (changes.enabled === true && skill.status === 'broken') {
    throw createSkillEditError('skill-broken', {
      message: 'This skill cannot be enabled',
      why: 'Its files are missing, or its licence is not allowed',
      fix: 'Restore an earlier version, or delete the skill',
    })
  }

  let updated: typeof schema.skills.$inferSelect | undefined

  try {
    [updated] = await db.update(schema.skills)
      .set(changes)
      .where(and(
        eq(schema.skills.id, skill.id),
        eq(schema.skills.userId, userId),
      ))
      .returning()
  } catch (exception) {
    if (findUniqueViolation(exception)?.includes('slash_name')) {
      throw createSkillCommandTakenError(changes.slashName ?? '')
    }

    throw exception
  }

  if (!updated) {
    throw createSkillEditError('skill-not-found', {
      message: 'Skill not found',
      why: 'The skill does not exist or is not yours',
      fix: 'Reload the skills list',
    })
  }

  input.logger.set({
    attributes: {
      skills: {
        settings: {
          changed: Object.keys(changes),
          mode: mode ?? null,
          enabled: updated.enabled,
          modelInvocable: updated.modelInvocable,
          hasCommand: updated.slashName !== null,
        },
      },
    },
  })

  return toSkillSummary(updated)
}
