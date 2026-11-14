import { and, eq } from 'drizzle-orm'
import { validateSkillSlashName } from '#shared/utils/skills-policy'
import { getSkillModeColumns } from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import { loadOwnedSkill } from '~~/server/utils/skills/versions/read'
import { toSkillSummary } from '~~/server/utils/skills/versions/view'

type DbClient = ReturnType<typeof useDb>

export interface SkillSettingsChanges {
  mode?: SkillMode
  enabled?: boolean
  modelInvocable?: boolean
  slashCommand?: boolean
  argumentHint?: string | null
}

/**
 * Settings are not content: no version is created. `mode` sets `enabled`,
 * `modelInvocable` and `slashCommand` together in one statement, and a
 * reserved name leaves `slashCommand` off instead of failing. The separate
 * flags still work for the MCP tools: switching "Use as /name" on is refused
 * for a reserved name ("/memory is reserved by Besidka"). A skill with
 * missing files cannot be enabled.
 */
export async function updateSkillSettings(input: {
  db: DbClient
  userId: number
  skillId: string
  changes: SkillSettingsChanges
  logger: LoggerLike
}) {
  const { db, userId } = input
  const { mode, ...flagChanges } = input.changes
  const skill = await loadOwnedSkill(db, userId, input.skillId)
  const changes = mode
    ? { ...flagChanges, ...getSkillModeColumns(mode, skill.name) }
    : flagChanges

  if (changes.slashCommand === true) {
    const validation = validateSkillSlashName(skill.name)

    if (!validation.valid) {
      throw createSkillEditError('reserved-name', {
        message: validation.message,
        why: validation.reason === 'reserved'
          ? 'This name belongs to a built-in command'
          : 'The name cannot be typed as a / command',
        fix: 'Rename the skill first, or leave "Use as /name" off',
      })
    }
  }

  if (changes.enabled === true && skill.status === 'broken') {
    throw createSkillEditError('skill-broken', {
      message: 'This skill cannot be enabled',
      why: 'Its files are missing, or its licence is not allowed',
      fix: 'Restore an earlier version, or delete the skill',
    })
  }

  const [updated] = await db.update(schema.skills)
    .set(changes)
    .where(and(
      eq(schema.skills.id, skill.id),
      eq(schema.skills.userId, userId),
    ))
    .returning()

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
          slashCommand: updated.slashCommand,
        },
      },
    },
  })

  return toSkillSummary(updated)
}
