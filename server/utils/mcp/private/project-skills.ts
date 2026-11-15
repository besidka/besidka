import { z } from 'zod'
import {
  PROJECT_SKILL_LEVELS,
  PROJECT_SKILLS_MAX,
} from '#shared/utils/skills-policy'
import {
  assertMcpSkillsAvailable,
  enforceMcpSkillWriteLimit,
  MCP_SKILL_ID_PATTERN,
} from '~~/server/utils/mcp/private/skills'
import type { McpSkillContext } from '~~/server/utils/mcp/private/skills'
import { readable } from '~~/server/utils/mcp/readable-error'
import {
  listProjectSkills,
  setProjectSkills,
} from '~~/server/utils/skills/project/pins'

export const mcpProjectSkillEntrySchema = z.object({
  skillId: z
    .string()
    .regex(MCP_SKILL_ID_PATTERN)
    .describe('Skill id from list_skills'),
  level: z
    .enum(PROJECT_SKILL_LEVELS)
    .describe('always: the skill goes into every message of the project\'s '
      + 'chats. prefer: the skill stays in the catalog, listed first for '
      + 'the model'),
})

export type McpProjectSkillsInput = {
  projectId: string
  skills: Array<z.infer<typeof mcpProjectSkillEntrySchema>>
}

export const MCP_PROJECT_SKILLS_MAX = PROJECT_SKILLS_MAX

/**
 * Replaces the skills pinned to one of the caller's projects. Every rule
 * (ownership of the project and of each skill, the limits, the token cap)
 * lives in `setProjectSkills`, the same function the app route calls. It
 * never changes a skill, so an Off skill stays Off and does not load. The
 * hourly skill-change counter is taken only once the checks have passed.
 */
export async function setMcpProjectSkills(
  context: McpSkillContext,
  input: McpProjectSkillsInput,
) {
  await assertMcpSkillsAvailable(context)

  const view = await readable(async () => {
    return await setProjectSkills(
      context.db,
      context.bucket,
      context.userId,
      input.projectId,
      input.skills,
      context.logger,
      { beforeWrite: () => enforceMcpSkillWriteLimit(context) },
    )
  })

  return {
    projectId: input.projectId,
    skills: view.pins.map(pin => ({
      skillId: pin.skillId,
      name: pin.name,
      level: pin.level,
      state: pin.state,
    })),
    alwaysTokens: view.alwaysTokens,
    limits: view.limits,
  }
}

/**
 * The pins of a project for `get_project`, or `null` when the token has no
 * `skills:read` or the skills feature is off for the user, so a project read
 * never reveals skill names to a client that was not given skills access.
 */
export async function readMcpProjectSkills(
  context: McpSkillContext,
  scopes: readonly string[],
  projectId: string,
) {
  if (!scopes.includes('skills:read')) {
    return null
  }

  try {
    await assertMcpSkillsAvailable(context)
  } catch (exception) {
    if ((exception as { why?: string }).why === 'feature_unavailable') {
      return null
    }

    throw exception
  }

  const view = await listProjectSkills(
    context.db,
    context.bucket,
    context.userId,
    projectId,
    context.logger,
  )

  return view.pins.map(pin => ({
    skillId: pin.skillId,
    name: pin.name,
    level: pin.level,
    state: pin.state,
  }))
}
