import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  normalizeSkillCommand,
  validateSkillSlashName,
} from '#shared/utils/skills-policy'
import { countStoredHighlights } from '#shared/utils/skills/findings'
import { getSkillModeColumns } from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { findUniqueViolation } from '~~/server/utils/skills/unique-violation'
import {
  createSkillCommandTakenError,
  createSkillEditError,
} from '~~/server/utils/skills/versions/errors'
import {
  loadOwnedSkill,
  loadVersionRow,
} from '~~/server/utils/skills/versions/read'
import {
  loadSkillIdsWithScripts,
  toSkillSummary,
} from '~~/server/utils/skills/versions/view'

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

  const taken = await findSkillUsingCommand({
    db: input.db,
    userId: input.userId,
    command,
    exceptSkillId: input.exceptSkillId,
  })

  if (taken) {
    throw createSkillCommandTakenError(command, taken.name)
  }

  return command
}

/**
 * The user's other skill that already has this command, if any. The write
 * paths call it before they write, and again when the unique index
 * `uq_skills_user_slash_name` refused a write that raced another one, so the
 * error can name that skill.
 */
export async function findSkillUsingCommand(input: {
  db: DbClient
  userId: number
  command: string
  exceptSkillId?: string
}): Promise<{ id: string, name: string } | null> {
  const [taken] = await input.db.select({
    id: schema.skills.id,
    name: schema.skills.name,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, input.userId),
      eq(schema.skills.slashName, input.command),
      input.exceptSkillId
        ? ne(schema.skills.id, input.exceptSkillId)
        : undefined,
    ))
    .limit(1)

  return taken ?? null
}

/**
 * The `command-taken` error for a write the unique index refused, naming
 * the skill that won the race when it can still be read.
 */
export async function createRacedCommandTakenError(input: {
  db: DbClient
  userId: number
  command: string
  exceptSkillId?: string
}) {
  try {
    const taken = await findSkillUsingCommand(input)

    return createSkillCommandTakenError(input.command, taken?.name ?? null)
  } catch {
    return createSkillCommandTakenError(input.command, null)
  }
}

/**
 * A skill a connected app saved is switched on by the user's review. When it
 * states no license, or a custom one, that review needs the same tick an
 * import asks for, so the user has seen the terms before it can run.
 */
function assertEnableLicenseAcknowledged(
  licenseClass: string,
  licenseAcknowledged: boolean | undefined,
): void {
  const needsTick = licenseClass === 'none' || licenseClass === 'custom'

  if (!needsTick || licenseAcknowledged === true) {
    return
  }

  throw createError({
    message: 'Confirm that you may use this skill',
    status: 400,
    code: 'license-acknowledgement-required',
    why: licenseClass === 'none'
      ? 'The skill states no license, so the author keeps all rights'
      : 'The skill carries a custom license',
    fix: 'Tick the license box when you turn the skill on',
  })
}

/**
 * Settings are not content: no version is created. `mode` sets `enabled` and
 * `modelInvocable` together in one statement and `command` is independent of
 * it: a reserved or invalid command is refused with a 400, a command another
 * skill already uses with a 409. A skill with missing files cannot be
 * enabled. Switching on a `needs-review` skill with no pending update is the
 * user's review, so it becomes `ready`.
 */
export async function updateSkillSettings(input: {
  db: DbClient
  userId: number
  skillId: string
  changes: SkillSettingsChanges
  licenseAcknowledged?: boolean
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
      why: 'Its files are missing, or its license is not allowed',
      fix: 'Restore an earlier version, or delete the skill',
    })
  }

  if (changes.enabled === true && skill.status === 'needs-review') {
    assertEnableLicenseAcknowledged(
      skill.licenseClass,
      input.licenseAcknowledged,
    )

    if (skill.pendingVersion === null) {
      changes.status = 'ready'
    }
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
      throw await createRacedCommandTakenError({
        db,
        userId,
        command: changes.slashName ?? '',
        exceptSkillId: skill.id,
      })
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

  const currentVersion = await loadVersionRow(
    db,
    userId,
    updated.id,
    updated.currentVersion,
  )

  const skillIdsWithScripts = await loadSkillIdsWithScripts(db, userId)

  return toSkillSummary(
    updated,
    null,
    countStoredHighlights(currentVersion?.findings),
    skillIdsWithScripts.has(updated.id),
  )
}
