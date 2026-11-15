import { and, eq } from 'drizzle-orm'
import { countStoredHighlights } from '#shared/utils/skills/findings'
import {
  hasSkillScripts,
  toProviderSkillName,
} from '#shared/utils/skills/scripts'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  loadAnthropicApiKey,
  removeProviderCopy,
} from '~~/server/utils/skills/provider-upload'
import type { ProviderSkillDeleteOutcome } from '~~/server/utils/skills/provider-upload'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
} from '~~/server/utils/skills/versions/read'
import { toSkillSummary } from '~~/server/utils/skills/versions/view'

type DbClient = ReturnType<typeof useDb>

const RENAME_CONFIRMATION_CLASSES = new Set(['none', 'custom'])

async function summarize(
  db: DbClient,
  userId: number,
  skill: typeof schema.skills.$inferSelect,
) {
  const [files, currentVersion] = await Promise.all([
    loadVersionFiles(db, userId, skill.id, skill.currentVersion),
    loadVersionRow(db, userId, skill.id, skill.currentVersion),
  ])

  return toSkillSummary(
    skill,
    null,
    countStoredHighlights(currentVersion?.findings),
    hasSkillScripts(files),
  )
}

/**
 * Turns "Allow scripts" on for one skill. Nothing is uploaded here: the copy
 * at Anthropic is made lazily, on the first send that the user allows, so
 * this only records the user's decision after the disclosure. It needs the
 * disclosure tick, a script in the current version, a name the provider
 * accepts and an Anthropic key. A name that has to change (`claude` and
 * `anthropic` are reserved words) is applied automatically for an open or
 * self-written skill and needs the user's confirmation for one with no or a
 * custom license.
 */
export async function enableSkillScripts(input: {
  db: DbClient
  userId: number
  skillId: string
  isDisclosureAccepted: boolean
  isRenameConfirmed: boolean
  logger: LoggerLike
}) {
  const { db, userId } = input
  const skill = await loadOwnedSkill(db, userId, input.skillId)

  if (skill.status === 'broken' || skill.licenseClass === 'restricted') {
    throw createSkillEditError('skill-broken', {
      message: 'Scripts cannot be allowed for this skill',
      why: 'Its files are missing, or its license is not allowed',
      fix: 'Restore an earlier version, or delete the skill',
    })
  }

  const files = await loadVersionFiles(
    db,
    userId,
    skill.id,
    skill.currentVersion,
  )

  if (!hasSkillScripts(files)) {
    throw createSkillEditError('scripts-missing', {
      message: 'This skill has no scripts',
      why: 'Its current version has no script file',
      fix: 'Add a script to the skill first',
    })
  }

  if (!input.isDisclosureAccepted) {
    throw createSkillEditError('scripts-disclosure-required', {
      message: 'Read and accept the notice first',
      why: 'The skill files are uploaded to your Anthropic workspace',
      fix: 'Accept the notice when you turn scripts on',
    })
  }

  const naming = toProviderSkillName(skill.name)

  if (!naming.ok) {
    throw createSkillEditError('scripts-name-invalid', {
      message: 'This skill name cannot be uploaded',
      why: 'The name does not fit the provider rules',
      fix: 'Rename the skill and try again',
    })
  }

  if (
    naming.isRenamed
    && RENAME_CONFIRMATION_CLASSES.has(skill.licenseClass)
    && !input.isRenameConfirmed
  ) {
    throw createSkillEditError('scripts-rename-confirmation-required', {
      message: 'The skill name has to change for the upload',
      why: 'Anthropic does not allow "anthropic" or "claude" in a skill name',
      fix: `Confirm the upload name ${naming.providerName}`,
      data: { providerName: naming.providerName },
    })
  }

  if (!await loadAnthropicApiKey(db, userId)) {
    throw createSkillEditError('scripts-key-missing', {
      message: 'Add your Anthropic API key first',
      why: 'Skill scripts run in your own Anthropic workspace',
      fix: 'Add the key on the API keys page',
    })
  }

  const [updated] = await db.update(schema.skills)
    .set({ allowScripts: true })
    .where(and(
      eq(schema.skills.id, skill.id),
      eq(schema.skills.userId, userId),
    ))
    .returning()

  input.logger.set({
    attributes: {
      skills: {
        scripts: {
          enabled: true,
          renamed: naming.isRenamed,
        },
      },
    },
  })

  return await summarize(db, userId, updated ?? skill)
}

/**
 * Turns "Allow scripts" off and deletes the copy at Anthropic. When the
 * delete fails the setting is still off, and the answer says so, so the
 * manager can point the user to the Anthropic Console.
 */
export async function disableSkillScripts(input: {
  db: DbClient
  userId: number
  skillId: string
  logger: LoggerLike
}): Promise<{
  skill: Awaited<ReturnType<typeof summarize>>
  providerCopy: ProviderSkillDeleteOutcome | 'none'
}> {
  const { db, userId } = input
  const skill = await loadOwnedSkill(db, userId, input.skillId)

  await db.update(schema.skills)
    .set({ allowScripts: false })
    .where(and(
      eq(schema.skills.id, skill.id),
      eq(schema.skills.userId, userId),
    ))

  const providerCopy = skill.providerSkillId && !skill.providerDeletedAt
    ? await removeProviderCopy({
      db,
      userId,
      skill,
      apiKey: await loadAnthropicApiKey(db, userId),
      logger: input.logger,
    })
    : 'none'
  const refreshed = await loadOwnedSkill(db, userId, skill.id)

  input.logger.set({
    attributes: {
      skills: { scripts: { enabled: false, providerCopy } },
    },
  })

  return { skill: await summarize(db, userId, refreshed), providerCopy }
}
