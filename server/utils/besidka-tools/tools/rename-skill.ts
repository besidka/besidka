import { z } from 'zod'
import {
  SKILL_NAME_MAX,
  SKILL_NAME_PATTERN,
} from '#shared/utils/skills-policy'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_ID_PATTERN,
  renameMcpSkill,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  id: z
    .string()
    .regex(MCP_SKILL_ID_PATTERN)
    .describe('Skill id from list_skills'),
  name: z
    .string()
    .min(1)
    .max(SKILL_NAME_MAX)
    .regex(SKILL_NAME_PATTERN)
    .describe('The new name: lowercase letters, digits and single hyphens, '
      + `1 to ${SKILL_NAME_MAX} characters, not used by another of your `
      + 'skills and not a name Besidka reserves'),
}

type RenameSkillInput = z.infer<z.ZodObject<typeof inputSchema>>

export const renameSkillBesidkaTool = defineBesidkaTool({
  name: 'rename_skill',
  title: 'Rename a skill',
  description: 'Rename one of your skills. Only the name line in the '
    + 'frontmatter of SKILL.md changes, as a new version; its command is a '
    + 'separate setting and stays. The skill is switched off and gets '
    + 'status needs-review, so it does not run under its new name until the '
    + 'user checks it. The skill is saved disabled. The user must review '
    + 'and enable it in Besidka at the reviewUrl in the result. At most 30 '
    + 'skill changes an hour. Requires signing in (skills:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server: a skill is a persistent instruction source, so a chat '
      + 'must not rename the skills that steer it.',
  },
  handler: async (input: RenameSkillInput, context) => {
    const result = await renameMcpSkill(buildMcpSkillContext(context), input)

    context.log({ skill_id: result.id })

    return result
  },
})
